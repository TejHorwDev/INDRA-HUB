import { app, BrowserWindow, net } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { open, rename, rm } from 'node:fs/promises'
import { basename } from 'node:path'
import type { UpdateDiagnostics, UpdateState } from '@shared/types'
import { restartBlocker, shouldAutoRestart } from '../lib/autorestart'
import {
  hashFile,
  payloadDir,
  prunePayloadDir,
  readVerifiedPending,
  removePayloadFile,
  runningVersion,
  writePending
} from '../lib/payload'
import { compareVersions } from '../lib/version'
import { busy as transferInFlight } from './downloads'
import { apiBase } from './catalog'
import {
  manifestUrl,
  releaseListUrl,
  selectRelease,
  type Release,
  type SelectedRelease
} from '../lib/releases'

/*
 * In-app updates.
 *
 * A release publishes a manifest (`payload.json`) and a payload — the compiled
 * app packed as one small `.asar`. This service finds the newest release *for
 * this app*, downloads the payload, checks its size and SHA-256, and leaves it
 * for the bootstrap to pick up at the next start. Applying an update is a
 * restart.
 *
 * Requests go through Electron's `net` first, not Node's `fetch`. `net` is
 * Chromium's stack, so it uses the system proxy and the system certificate
 * store. Node's fetch ignores proxy configuration entirely, which on some
 * networks is the whole difference between a two-second check and a timeout.
 */

const REPO = 'TejHorwDev/INDRA-HUB'
/** Both apps publish here; only this prefix is ours. See lib/releases.ts. */
const TAG_PREFIX = 'loader-v'

const FIRST_CHECK_DELAY_MS = 3_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const FOCUS_CHECK_AFTER_MS = 60 * 60 * 1000
/** A failed check should heal itself, not wait four hours. */
const ERROR_RETRY_MS = 10 * 60 * 1000
const MANIFEST_TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000
const STALL_TIMEOUT_MS = 60_000
const PROGRESS_INTERVAL_MS = 250

/**
 * A silent restart is worth trying once. If it comes back on the same version,
 * the payload did not load, and trying again would be a loop that looks like the
 * app crashing on every launch.
 */
const RESTART_GUARD_MS = 10 * 60 * 1000
/** Long enough that the window has painted, short enough to feel deliberate. */
const AUTO_RESTART_DELAY_MS = 900

const packaged = app.isPackaged

interface Manifest {
  version: string
  file: string
  sha256: string
  size: number
  url?: string
}

let firstCheck: NodeJS.Timeout | null = null
let interval: NodeJS.Timeout | null = null
let retry: NodeJS.Timeout | null = null
let lastAttempt = 0
let running = false

/* ------------------------------------------------------- silent restarting */

let startedAt = Date.now()
/** The screen the renderer last reported, used only to decide about restarting. */
let screen = 'splash'
/**
 * Whether a text field is focused or filled.
 *
 * The screen alone cannot answer this — an empty form and half a typed password are
 * the same screen — so the window reports it and this is the one place it lands.
 */
let typing = false
let restarted = false
/**
 * A payload that was restarted into and did not load, by version.
 *
 * It used to be a boolean for the process's lifetime, which meant one transient
 * failure refused every later restart for that run — including a *different* version
 * downloaded an hour later. Scoped to the version, it expires with the guard and a
 * fresh payload starts with a clean slate.
 */
let blockedVersion: string | null = null
/** Re-asks the question later, so a ready payload can never be stranded. */
let reconsider: NodeJS.Timeout | null = null
/** The last refusal written to the log, so the log stays a record and not a flood. */
let lastVerdict: string | null = null

const guardFile = (): string => join(app.getPath('userData'), 'update-auto-restart.json')

/**
 * What the updater did, in a file.
 *
 * Every answer to "it does not update" so far has needed somebody to guess on the
 * user's behalf. This is the end of guessing: each attempt appends one line — which
 * source answered, what version, where it stopped — and Settings shows the last few.
 * Nothing here is sensitive; it is a version number and a sentence.
 */
const logFile = (): string => join(app.getPath('userData'), 'update-log.txt')
const LOG_LIMIT = 40

export function logLine(text: string): void {
  const line = `${new Date().toISOString()} ${text}`
  console.log('[updates]', text)
  try {
    const existing = existsSync(logFile()) ? readFileSync(logFile(), 'utf8').split('\n').filter(Boolean) : []
    existing.push(line)
    writeFileSync(logFile(), `${existing.slice(-LOG_LIMIT).join('\n')}\n`)
  } catch {
    /* a log that cannot be written is not a reason to stop updating */
  }
}

/** The tail of that log, newest last. */
export function updateLog(): string[] {
  try {
    return readFileSync(logFile(), 'utf8').split('\n').filter(Boolean).slice(-8)
  } catch {
    return []
  }
}

function readGuard(): { target: string; at: number } | null {
  try {
    const parsed = JSON.parse(readFileSync(guardFile(), 'utf8')) as { target?: unknown; at?: unknown }
    if (typeof parsed.target !== 'string' || typeof parsed.at !== 'number') return null
    return { target: parsed.target, at: parsed.at }
  } catch {
    return null
  }
}

/**
 * Has a restart for this version already been tried and not taken?
 *
 * If the app came back on the old payload after claiming to install a new one, the
 * payload did not load. Trying again on the next launch would be a restart loop that
 * looks like a crash on startup, so the version is left alone until a different one
 * is published or the guard expires.
 */
function restartAlreadyTried(version: string): boolean {
  const guard = readGuard()
  if (!guard) return false
  if (guard.target !== version) return false
  if (Date.now() - guard.at > RESTART_GUARD_MS) {
    clearGuard()
    return false
  }
  return true
}

/**
 * The version this launch was restarted into, when it was the updater that did it.
 *
 * Read once at startup from the claim written a second before the relaunch, and only
 * trusted when the running version is the one the claim named — so this is never a
 * guess about what happened, it is the updater's own receipt. Used to say "updated"
 * out loud, because an update that applies silently and then asks for a password is
 * indistinguishable from one that never happened.
 */
const applied = (() => {
  try {
    const guard = readGuard()
    return guard && guard.target === runningVersion() ? guard.target : null
  } catch {
    return null
  }
})()

export function appliedUpdateVersion(): string | null {
  return applied
}

function clearGuard(): void {
  try {
    rmSync(guardFile(), { force: true })
  } catch {
    /* a guard that cannot be removed is not a reason to stop */
  }
}

let state: UpdateState = {
  phase: packaged ? 'idle' : 'unsupported',
  currentVersion: runningVersion(),
  installedVersion: app.getVersion(),
  version: null,
  percent: 0,
  bytesPerSecond: 0,
  message: packaged ? null : 'Updates only run in the installed app, not in development.',
  detail: null,
  checkedAt: null,
  canCheck: packaged,
  canInstall: false
}

function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('update:state', state)
  }
}

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  broadcast()
}

export function updateState(): UpdateState {
  return { ...state, currentVersion: runningVersion(), installedVersion: app.getVersion() }
}

/** Chromium's networking first, Node's second. */
async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await net.fetch(url, init)
  } catch (error) {
    console.warn('[updates] chromium request failed, retrying with node networking', error)
    return fetch(url, init)
  }
}

function technical(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause
    const detail = cause instanceof Error ? ` (${cause.message})` : ''
    return `${error.name}: ${error.message}${detail}`.slice(0, 300)
  }
  return String(error).slice(0, 300)
}

const GENERIC_FAILURE = 'The update could not be checked. Try again later.'

/** Turns anything that can go wrong into a sentence a person can act on. */
function explain(error: unknown): string {
  const text = technical(error)

  if (/abort|timeout|timed out/i.test(text)) {
    return 'GitHub did not answer within 30 seconds. The update check will try again later.'
  }
  if (/not valid json|unexpected token|did not return an update manifest/i.test(text)) {
    return 'GitHub answered, but not with an update manifest. This usually clears up on its own — try again in a few minutes.'
  }
  if (/manifest is not valid/i.test(text)) {
    return 'The update published for this release is not usable. Nothing was downloaded.'
  }
  if (/HTTP 404/i.test(text)) {
    return 'No in-app update has been published yet. Try again later.'
  }
  if (/HTTP 403|HTTP 429|rate limit/i.test(text)) {
    return 'GitHub is refusing requests from this machine for now. Try again later.'
  }
  if (/HTTP 5\d\d/i.test(text)) {
    return 'GitHub is having trouble. Try again later.'
  }
  if (
    /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EPROTO|CERT|SSL|getaddrinfo|net::|fetch failed|ERR_/i.test(
      text
    )
  ) {
    return 'The update server could not be reached. Check the connection — and if this machine uses a proxy, make sure it is reachable.'
  }
  if (/invalid package/i.test(text)) {
    return 'The downloaded update file could not be read. It has been discarded — try again.'
  }
  if (/checksum|size mismatch/i.test(text)) {
    return 'The downloaded update was damaged and has been discarded. It will be tried again.'
  }
  return GENERIC_FAILURE
}

async function probe(url: string, init: RequestInit = {}): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await request(url, { ...init, signal: controller.signal, cache: 'no-store' })
    return `HTTP ${response.status}`
  } catch (error) {
    return technical(error)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * When the check fails, find out *where*.
 *
 * "The server could not be reached" is true of three very different problems:
 * no DNS at all, a filter that blocks GitHub's download host (it lives on its
 * own domain, `release-assets.githubusercontent.com`), or a manifest that is
 * there but wrong. Two probes tell them apart, and the answer goes in `detail`.
 */
async function diagnose(): Promise<{ text: string; verdict: string | null }> {
  const api = await probe(releaseListUrl(REPO), { headers: { accept: 'application/vnd.github+json' } })
  const apiOk = /HTTP 2\d\d/.test(api)
  const download = await probe(`https://github.com/${REPO}`, { headers: { range: 'bytes=0-0' } })
  const githubOk = /HTTP [23]\d\d/.test(download)

  const text = `api.github.com ${api} · github.com ${download}`

  if (apiOk && !githubOk) {
    return {
      text,
      verdict:
        'GitHub is reachable but its download servers are not — a DNS filter, VPN or firewall is usually behind this.'
    }
  }
  if (!apiOk && /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(api)) {
    return { text, verdict: 'This machine cannot look up GitHub at all. Check the connection or any DNS filter.' }
  }
  if (!apiOk && /CERT|SSL|EPROTO/i.test(api)) {
    return {
      text,
      verdict:
        'Something is intercepting secure traffic to GitHub — a proxy or antivirus web shield. Allow INDRA LOADER through it and try again.'
    }
  }
  return { text, verdict: null }
}

/*
 * The panel first, GitHub second.
 *
 * GitHub serves release assets from `release-assets.githubusercontent.com`, which is
 * filtered on a lot of networks — sometimes by an ISP, sometimes by an antivirus web
 * shield, sometimes by a router nobody remembers configuring. When that host is
 * blocked, the direct path cannot update and cannot explain itself.
 *
 * Our own service has to be reachable anyway: it is where the catalogue comes from.
 * So it is asked first, it answers with the version, the hash and a payload URL on
 * its own domain, and the download never touches GitHub at all. The direct path
 * stays as the fallback for the day the panel is down but GitHub is not.
 */

/** What the panel says the newest loader is, or throws if the panel cannot answer. */
async function latestViaPanel(): Promise<{ release: SelectedRelease; manifest: Manifest } | null> {
  const base = apiBase()
  if (!base) throw new Error('no catalogue address')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS)
  try {
    const response = await request(`${base}/api/loader/update`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const body = (await response.json()) as {
      update?: {
        version?: unknown
        tag?: unknown
        publishedAt?: unknown
        file?: unknown
        sha256?: unknown
        size?: unknown
        url?: unknown
      } | null
    }

    const update = body.update
    if (!update) return null

    const version = typeof update.version === 'string' ? update.version : ''
    const file = typeof update.file === 'string' ? update.file : ''
    const sha256 = typeof update.sha256 === 'string' ? update.sha256.toLowerCase() : ''

    if (!version || !file.endsWith('.asar') || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error('the panel sent an update that is not usable')
    }

    return {
      release: {
        tag: typeof update.tag === 'string' ? update.tag : `loader-v${version}`,
        version,
        publishedAt: typeof update.publishedAt === 'string' ? update.publishedAt : ''
      },
      manifest: {
        version,
        file,
        sha256,
        size: Number(update.size) || 0,
        url: typeof update.url === 'string' ? update.url : undefined
      }
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Asks GitHub which release is this app's newest. `null` when there is none. */
async function latestRelease(): Promise<SelectedRelease | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS)
  try {
    const response = await request(releaseListUrl(REPO), {
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
      headers: { accept: 'application/vnd.github+json', 'cache-control': 'no-cache' }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const body = (await response.json()) as Release[]
    if (!Array.isArray(body)) throw new Error('the release list is not valid')
    return selectRelease(body, TAG_PREFIX)
  } finally {
    clearTimeout(timer)
  }
}

async function fetchManifest(release: SelectedRelease): Promise<Manifest> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS)
  try {
    const response = await request(manifestUrl(REPO, release.tag), {
      signal: controller.signal,
      redirect: 'follow',
      cache: 'no-store',
      headers: { accept: 'application/json', 'cache-control': 'no-cache' }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const raw = await response.text()
    let body: Partial<Manifest>
    try {
      body = JSON.parse(raw) as Partial<Manifest>
    } catch {
      throw new Error(
        `did not return an update manifest (content-type ${response.headers.get('content-type') ?? 'unknown'})`
      )
    }

    if (
      typeof body.version !== 'string' ||
      typeof body.file !== 'string' ||
      typeof body.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(body.sha256) ||
      !body.file.toLowerCase().endsWith('.asar')
    ) {
      throw new Error('the manifest is not valid')
    }

    // The tag is the authority on version; a manifest that disagrees with the
    // release it came from is a publishing mistake, not an upgrade.
    if (compareVersions(body.version, release.version) !== 0) {
      throw new Error(`the manifest says ${body.version} but the release is ${release.version}`)
    }

    return { ...body, size: Number(body.size) || 0 } as Manifest
  } finally {
    clearTimeout(timer)
  }
}

/** One immediate retry for anything that is not a plain 4xx. */
/**
 * The newest build, and where to get it.
 *
 * Panel first, GitHub second, and the answer says which — because when an update
 * fails the first question is which half of the path was missing.
 */
async function resolveNewest(): Promise<{ release: SelectedRelease; manifest: Manifest } | null> {
  try {
    const viaPanel = await latestViaPanel()
    if (viaPanel) return viaPanel
    // The panel answered and there is no release: that is an answer, not a failure.
    return null
  } catch (error) {
    console.warn('[updates] panel lookup failed, asking github directly', technical(error))
  }

  const release = await latestRelease()
  if (!release) return null
  return { release, manifest: await fetchManifestWithRetry(release) }
}

async function fetchManifestWithRetry(release: SelectedRelease): Promise<Manifest> {
  try {
    return await fetchManifest(release)
  } catch (error) {
    if (/HTTP 4\d\d/i.test(technical(error))) throw error
    console.warn('[updates] manifest attempt failed, retrying once', technical(error))
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    return fetchManifest(release)
  }
}

function urlOf(manifest: Manifest, release: SelectedRelease): string {
  return manifest.url || manifestUrl(REPO, release.tag)
}

/** Streams the payload to disk, reporting progress, and proves what arrived. */
async function downloadPayload(manifest: Manifest, release: SelectedRelease): Promise<string> {
  // The manifest names a release asset; never a path.
  const name = basename(manifest.file)

  /*
   * The temporary file deliberately contains no ".asar".
   *
   * Electron turns every path containing ".asar" into an archive lookup, so
   * `…payload.asar.part` is read as an *entry* of `…payload.asar` and fails with
   * "Invalid package" — the reason a download can arrive intact and still be
   * thrown away. Written as ".download", hashed, then renamed: renaming is not
   * intercepted.
   */
  const target = join(payloadDir(), `incoming-${name.replace(/\.asar$/i, '')}.download`)
  const controller = new AbortController()
  let stall: NodeJS.Timeout | undefined

  const resetStall = (): void => {
    clearTimeout(stall)
    stall = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS)
  }
  const overall = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  resetStall()

  const handle = await open(target, 'w')
  let received = 0
  let windowStart = Date.now()
  let windowBytes = 0
  let lastProgress = 0

  try {
    const response = await request(urlOf(manifest, release), {
      signal: controller.signal,
      redirect: 'follow',
      cache: 'no-store'
    })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)

    const total = Number(response.headers.get('content-length')) || manifest.size || 0

    for await (const chunk of response.body) {
      resetStall()
      await handle.write(chunk)
      received += chunk.length
      windowBytes += chunk.length

      const now = Date.now()
      if (now - lastProgress >= PROGRESS_INTERVAL_MS) {
        lastProgress = now
        const elapsed = Math.max(1, now - windowStart)
        const speed = Math.round((windowBytes * 1000) / elapsed)
        windowStart = now
        windowBytes = 0
        setState({
          phase: 'downloading',
          percent: total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0,
          bytesPerSecond: speed
        })
      }
    }
  } finally {
    clearTimeout(overall)
    clearTimeout(stall)
    await handle.close()
  }

  if (manifest.size > 0 && received !== manifest.size) {
    await rm(target, { force: true })
    throw new Error(`size mismatch: expected ${manifest.size}, received ${received}`)
  }

  const digest = hashFile(target)
  if (digest.toLowerCase() !== manifest.sha256.toLowerCase()) {
    await rm(target, { force: true })
    throw new Error('checksum mismatch')
  }

  const final = join(payloadDir(), name)

  // Not `rm`: it is built on `lstat`, which the asar layer answers for any path
  // containing ".asar". `unlink` goes to the binding.
  removePayloadFile(name)
  await rename(target, final)
  return name
}

export async function checkForUpdates(manual = false): Promise<UpdateState> {
  if (!packaged) return updateState()
  if (running) return updateState()

  // Never interrupt a download that is already under way.
  if (state.phase === 'downloading' || state.phase === 'ready') return updateState()

  running = true
  lastAttempt = Date.now()

  /*
   * A payload already on disk beats anything the network has to say.
   *
   * It was downloaded and verified on an earlier run; the only thing it is waiting
   * for is a restart. Requiring a successful check first meant that an update could
   * sit there forever on a machine whose update feed had become unreachable — the
   * app would rather be out of date than restart into a build it already had.
   */
  const staged = readVerifiedPending()
  if (
    staged &&
    compareVersions(staged.version, runningVersion()) > 0 &&
    !restartAlreadyTried(staged.version)
  ) {
    setState({
      phase: 'ready',
      version: staged.version,
      percent: 100,
      canInstall: true,
      detail: null,
      checkedAt: new Date().toISOString(),
      message: `Version ${staged.version} is ready. Restart to apply it.`
    })
    running = false
    maybeAutoRestart()
    return updateState()
  }

  setState({ phase: 'checking', message: manual ? 'Checking for updates…' : null, detail: null })

  try {
    const resolved = await resolveNewest()
    if (!resolved) {
      setState({
        phase: 'up-to-date',
        version: null,
        percent: 0,
        canInstall: false,
        detail: null,
        checkedAt: new Date().toISOString(),
        message: `You are on the newest version (${runningVersion()}).`
      })
      return updateState()
    }
    const { release, manifest } = resolved
    const current = runningVersion()
    logLine(`found ${release.tag} (running ${current})`)

    if (compareVersions(manifest.version, current) <= 0) {
      setState({
        phase: 'up-to-date',
        version: null,
        percent: 0,
        canInstall: false,
        detail: null,
        checkedAt: new Date().toISOString(),
        message: `You are on the newest version (${current}).`
      })
      return updateState()
    }

    // Already downloaded and waiting for a restart.
    const pending = readVerifiedPending()
    if (pending && pending.version === manifest.version) {
      setState({
        phase: 'ready',
        version: pending.version,
        percent: 100,
        canInstall: true,
        detail: null,
        checkedAt: new Date().toISOString(),
        message: `Version ${pending.version} is ready. Restart to apply it.`
      })
      return updateState()
    }

    setState({
      phase: 'available',
      version: manifest.version,
      percent: 0,
      canInstall: false,
      detail: null,
      message: `Version ${manifest.version} is downloading.`
    })

    const file = await downloadPayload(manifest, release)
    writePending({ version: manifest.version, file, sha256: manifest.sha256, size: manifest.size })
    /*
     * A payload that has just been verified is not the payload that failed to load.
     * The guard names a version, and a stale claim about it must not survive a new
     * download — otherwise a machine that once had a bad restart would refuse every
     * later one, which is exactly the "sometimes it works" this is here to end.
     */
    if (blockedVersion === manifest.version) blockedVersion = null
    clearGuard()
    lastVerdict = null
    logLine(`downloaded ${manifest.version} (${manifest.size} bytes) as ${file}`)

    setState({
      phase: 'ready',
      version: manifest.version,
      percent: 100,
      bytesPerSecond: 0,
      canInstall: true,
      detail: null,
      checkedAt: new Date().toISOString(),
      message: `Version ${manifest.version} is ready. Restart to apply it.`
    })
    return updateState()
  } catch (error) {
    console.error('[updates] check failed', error)
    logLine(`check failed: ${technical(error)}`)

    // Ask where it broke before apologising, so the panel can say something
    // specific. Never let the diagnosis become the failure.
    let verdict: string | null = null
    let detail = `build ${runningVersion()} · ${technical(error)}`
    try {
      const diagnosis = await diagnose()
      verdict = diagnosis.verdict
      detail = `${detail} — ${diagnosis.text}`
    } catch {
      /* the diagnosis is a courtesy, not a requirement */
    }

    const sentence = explain(error)
    setState({
      phase: 'error',
      checkedAt: new Date().toISOString(),
      canInstall: false,
      message: sentence === GENERIC_FAILURE && verdict ? verdict : sentence,
      detail
    })

    // A transient failure should not mean waiting four hours.
    if (retry) clearTimeout(retry)
    retry = setTimeout(() => void checkForUpdates(false), ERROR_RETRY_MS)
    retry.unref()

    return updateState()
  } finally {
    running = false
    maybeAutoRestart()
  }
}

/**
 * The renderer's current screen.
 *
 * One of two inputs that make a silent restart safe. Kept for the launch card,
 * which uses it to stand the rule down while it runs its own sequence.
 */
export function noteScreen(next: string): void {
  if (next === screen) return
  screen = next
  maybeAutoRestart()
}

/**
 * What the window is doing, not just what it is showing.
 *
 * `typing` is the fact the screen name cannot carry: an empty sign-in form and a
 * half-typed password are both `signin`. Every report re-asks the restart
 * question, which is the actual fix — the decision used to be made once, at the
 * instant a download finished, and whatever was on screen *then* decided it
 * forever. Download at launch, glance away, and the update waited for a restart
 * nobody was going to perform.
 */
export function noteActivity(next: { screen?: string; typing?: boolean }): void {
  if (typeof next.screen === 'string' && next.screen !== screen) screen = next.screen
  const nowTyping = next.typing === true
  const changed = nowTyping !== typing
  typing = nowTyping
  if (changed) maybeAutoRestart()
}

/**
 * Relaunch into the payload, once, correctly.
 *
 * Two lines here were the difference between an update and an app that closes:
 *
 *   app.relaunch(); app.exit(0)
 *
 * This app takes the single-instance lock at startup. `relaunch` spawns the new
 * process while this one is still alive and still holding that lock, so the new
 * process lost the race, `requestSingleInstanceLock()` answered false, and it exited
 * before drawing anything. The old process then quit too. The update had applied; the
 * window simply never came back, which from the outside looks exactly like "the
 * updater is broken, sometimes".
 *
 * Releasing the lock first makes the handover ordered, and the short delay before
 * `exit` lets the child start rather than being born into a dying parent.
 */
function relaunchNow(): void {
  try {
    app.releaseSingleInstanceLock()
  } catch {
    /* a lock that cannot be released is one less thing that can go wrong */
  }
  app.relaunch()
  setTimeout(() => app.exit(0), 250)
}

/**
 * Restart into a ready payload, without asking, when nothing is at risk.
 *
 * The payload is on disk and verified before this is called — the restart only
 * chooses to run what the next launch was going to run anyway.
 */
function autoRestartInput(): Parameters<typeof restartBlocker>[0] {
  return {
    packaged,
    phase: state.phase,
    screen,
    idle: !typing && !transferInFlight(),
    runningForMs: Date.now() - startedAt,
    alreadyRestarted: restarted,
    blocked: blockedVersion !== null && blockedVersion === state.version
  }
}

function maybeAutoRestart(): void {
  const input = autoRestartInput()
  const blocker = restartBlocker(input)

  if (blocker !== null) {
    /*
     * Say why, once per reason. A log that repeats the same sentence every few
     * seconds is a log nobody reads; a log that changes when the reason changes is
     * the answer to "it did not restart — why?".
     */
    if (blocker !== lastVerdict && state.phase === 'ready') {
      lastVerdict = blocker
      logLine(`auto-restart: waiting — ${blocker}`)
    }

    /*
     * A ready payload is never left to rot. Something is in hand now; it will not
     * be in hand forever, and if the window never reports again (a screen that
     * throws, a renderer that hangs) this is what still gets the update applied.
     */
    if (
      state.phase === 'ready' &&
      !blockedVersion &&
      !restarted &&
      screen !== 'launch-card' &&
      reconsider === null
    ) {
      reconsider = setTimeout(() => {
        reconsider = null
        maybeAutoRestart()
      }, 15_000)
      reconsider.unref()
    }
    return
  }

  lastVerdict = null
  restarted = true
  if (reconsider) {
    clearTimeout(reconsider)
    reconsider = null
  }

  setTimeout(() => {
    const pending = readVerifiedPending()
    // The file could have been removed in the last second. Without it the
    // restart would be a very expensive way of doing nothing — and `restarted`
    // goes back so the decision is not spent on nothing.
    if (!pending) {
      restarted = false
      return
    }
    /*
     * A field took focus in the last second. The restart can wait, and it will not
     * be forgotten: `restarted` goes back to false and the next activity report —
     * the one where the field is left — asks the question again.
     */
    if (typing) {
      restarted = false
      return
    }

    // The claim on this restart, written before it happens: if the next launch is
    // still on the old version, `initUpdates` reads this and stays quiet.
    try {
      writeFileSync(guardFile(), JSON.stringify({ target: pending.version, at: Date.now() }))
    } catch {
      /* without the guard we still know ourselves: `restarted` is already true */
    }

    logLine(`restarting into ${pending.version}`)
    relaunchNow()
  }, AUTO_RESTART_DELAY_MS)
}

/**
 * Applying an update is a restart.
 *
 * The payload is already on disk and verified; the bootstrap loads it on the way
 * up. Nothing is spawned, nothing is installed, and a cancelled restart changes
 * nothing.
 */
export function installUpdate(options: { manual?: boolean } = {}): UpdateState {
  if (state.phase !== 'ready') return updateState()

  /*
   * One restart per version. If a previous launch claimed to install this build and
   * came back on the old one, the payload does not load — restarting again would be
   * an app that closes itself every time it opens.
   *
   * Unless a person asks. The guard exists to stop the *app* from looping; it was
   * never meant to refuse somebody who pressed Install and watched nothing happen.
   * A manual install clears it, and that cannot loop: it needs another press.
   */
  const staged = readVerifiedPending()
  if (staged && restartAlreadyTried(staged.version) && !options.manual) {
    blockedVersion = staged.version
    setState({
      phase: 'error',
      canInstall: false,
      message: `Version ${staged.version} did not start last time, so it will not be tried again. Reinstall from the website if the app is out of date.`,
      detail: `guard: ${staged.version} at ${new Date(readGuard()?.at ?? Date.now()).toISOString()}`
    })
    return updateState()
  }

  if (options.manual && staged) {
    clearGuard()
    blockedVersion = null
    logLine(`manual install of ${staged.version}, guard cleared`)
  }

  if (!readVerifiedPending()) {
    setState({
      phase: 'up-to-date',
      version: null,
      percent: 0,
      canInstall: false,
      message: 'That update is no longer on disk. Check again to fetch it.'
    })
    return updateState()
  }

  setImmediate(relaunchNow)

  return updateState()
}

/** Called when the window regains focus — at most once an hour. */
export function checkForUpdatesOnFocus(): void {
  if (!packaged) return
  if (Date.now() - lastAttempt < FOCUS_CHECK_AFTER_MS) return
  if (state.phase === 'downloading' || state.phase === 'ready' || state.phase === 'checking') return
  void checkForUpdates(false)
}

/**
 * Proves the update path end to end, on demand.
 *
 * Three real requests, the same ones a check makes, each reported with what came
 * back — so "it says there is no update" can be told apart from "it cannot reach
 * GitHub".
 */
export async function diagnoseConnection(): Promise<UpdateDiagnostics> {
  const steps: UpdateDiagnostics['steps'] = []
  let latestVersion: string | null = null

  const run = async (label: string, probe: () => Promise<string>): Promise<boolean> => {
    try {
      steps.push({ label, ok: true, detail: await probe() })
      return true
    } catch (error) {
      steps.push({ label, ok: false, detail: technical(error) })
      return false
    }
  }

  await run('Update feed', async () => {
    const viaPanel = await latestViaPanel()
    if (!viaPanel) return 'the panel is reachable — no release of this app has been published yet'
    const { release, manifest } = viaPanel
    latestVersion = manifest.version
    return `the panel says ${release.tag}, ${Math.round(manifest.size / 1024)} KB`
  })

  await run('Update manifest', async () => {
    const resolved = await resolveNewest()
    if (!resolved) throw new Error('no release of this app has been published yet')
    const { release, manifest } = resolved
    if (!latestVersion) latestVersion = manifest.version
    return `version ${manifest.version} from ${release.tag}`
  })

  await run('Payload download', async () => {
    const resolved = await resolveNewest()
    if (!resolved) throw new Error('no release of this app has been published yet')
    const { release, manifest } = resolved
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      // One byte is enough: this proves the host serves the file, not just that
      // the URL exists.
      const response = await request(urlOf(manifest, release), {
        signal: controller.signal,
        cache: 'no-store',
        headers: { range: 'bytes=0-0' }
      })
      if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`)
      return `HTTP ${response.status}`
    } finally {
      clearTimeout(timer)
    }
  })

  const ok = steps.every((step) => step.ok)
  return {
    steps,
    latestVersion,
    ok,
    summary: ok
      ? `Everything works. Version ${latestVersion ?? runningVersion()} is reachable and could be installed.`
      : 'Something in the update path is not reachable from this machine.'
  }
}

/**
 * Called once at startup, after the window and IPC are ready.
 *
 * `skipFirstCheck` is set when the launch card has already asked — the answer is
 * on screen before this runs, and a second manifest fetch seconds later would
 * only spend a request to learn the same thing.
 */
export function initUpdates(skipFirstCheck = false): void {
  if (!packaged) return

  startedAt = Date.now()

  /*
   * Did a silent restart already happen? If the version it claimed to install is
   * running now, the guard has done its job and is deleted. If it is not, the
   * payload did not load and no second attempt is made this session.
   */
  const guard = readGuard()
  if (guard) {
    if (guard.target === runningVersion()) {
      // It worked: the guard has done its job and the version is current.
      clearGuard()
    } else if (Date.now() - guard.at < RESTART_GUARD_MS) {
      blockedVersion = guard.target
      logLine(`auto-restart: ${guard.target} did not load last launch, holding it for a while`)
    } else {
      clearGuard()
    }
  }

  // Debris from an interrupted download is never useful.
  prunePayloadDir()

  /*
   * A payload downloaded in a previous session is already in place: the bootstrap
   * consumes it on the way up, so normally there is nothing here. When there is —
   * the file arrived after the bootstrap ran, or the adoption failed — it is
   * announced *and* the restart question is asked immediately, instead of waiting
   * for a four-hour tick that used to leave the update on disk for a day.
   */
  const pending = readVerifiedPending()
  if (pending && compareVersions(pending.version, runningVersion()) > 0) {
    setState({
      phase: 'ready',
      version: pending.version,
      percent: 100,
      canInstall: true,
      message: `Version ${pending.version} is ready. Restart to apply it.`
    })
    maybeAutoRestart()
  }

  if (!skipFirstCheck) {
    firstCheck = setTimeout(() => void checkForUpdates(false), FIRST_CHECK_DELAY_MS)
    firstCheck.unref()
  }

  // A payload left over from last session is applied by the bootstrap before this
  // file runs, so `runningVersion()` already answers with it. Nothing to do here
  // beyond the check above.

  interval = setInterval(() => void checkForUpdates(false), CHECK_INTERVAL_MS)
  interval.unref()
}
