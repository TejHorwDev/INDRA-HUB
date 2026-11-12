import { app, BrowserWindow, net } from 'electron'
import { open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { UpdateState } from '@shared/types'
import {
  compareVersions,
  hashFile,
  payloadDir,
  readPending,
  runningVersion,
  writePending
} from '../lib/payload'

/*
 * In-app updates.
 *
 * A release publishes a manifest (`payload.json`) and a payload — the compiled
 * app packed as one small `.asar`. This service fetches the manifest, downloads
 * the payload, checks its size and SHA-256, and leaves it for the bootstrap to
 * pick up at the next start. Applying an update is a restart.
 *
 * Requests go through Electron's `net` first, not Node's `fetch`. That matters:
 * `net` is Chromium's stack, so it uses the system proxy, the system certificate
 * store and the same redirect behaviour as the browser that can plainly reach
 * GitHub. Node's fetch ignores proxy configuration entirely, which on some
 * networks is the whole difference between a two-second check and a timeout.
 */

const MANIFEST_URL = 'https://github.com/TejHorwDev/INDRA-HUB/releases/latest/download/payload.json'
const FIRST_CHECK_DELAY_MS = 3_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const FOCUS_CHECK_AFTER_MS = 60 * 60 * 1000
/** A failed check should heal itself, not wait four hours. */
const ERROR_RETRY_MS = 10 * 60 * 1000
const MANIFEST_TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000
const STALL_TIMEOUT_MS = 60_000
const PROGRESS_INTERVAL_MS = 250

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

let state: UpdateState = {
  phase: packaged ? 'idle' : 'unsupported',
  currentVersion: runningVersion(),
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
  // The version can change under us once a payload has booted.
  return { ...state, currentVersion: runningVersion() }
}

/**
 * Chromium's networking first, Node's second.
 *
 * `net.fetch` is only usable once the app is ready, which it is by the time any
 * check runs.
 */
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

/** Turns anything that can go wrong into a sentence a person can act on. */
const GENERIC_FAILURE = 'The update could not be checked. Try again later.'

/** A guess at what went wrong, for a person to act on. */
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
  if (/checksum|size mismatch/i.test(text)) {
    return 'The downloaded update was damaged and has been discarded. It will be tried again.'
  }
  return GENERIC_FAILURE
}

/**
 * When the check fails, find out *where*.
 *
 * "The server could not be reached" is true of three very different problems:
 * no DNS at all, a filter that blocks GitHub's download host (a common one —
 * it lives on its own domain, `release-assets.githubusercontent.com`), or a
 * manifest that is there but wrong. One probe of the API and one of the file
 * tell them apart, and the answer goes in `detail` where the panel shows it.
 */
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

interface Diagnosis {
  /** What was learned, for the detail line. */
  text: string
  /** A better sentence, when the cause is clear. */
  verdict: string | null
}

async function diagnose(): Promise<Diagnosis> {
  const api = await probe('https://api.github.com/repos/TejHorwDev/INDRA-HUB/releases/latest', {
    headers: { accept: 'application/vnd.github+json' }
  })
  const apiOk = /HTTP 2\d\d/.test(api)
  const download = await probe(
    'https://github.com/TejHorwDev/INDRA-HUB/releases/latest/download/payload.json',
    { headers: { range: 'bytes=0-0' } }
  )
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
        'Something is intercepting secure traffic to GitHub — a proxy or antivirus web shield. Allow INDRA HUB through it and try again.'
    }
  }
  if (githubOk) {
    return { text, verdict: null }
  }
  return { text, verdict: null }
}

function manifestUrl(manifest: Manifest): string {
  if (manifest.url) return manifest.url
  return `https://github.com/TejHorwDev/INDRA-HUB/releases/latest/download/${manifest.file}`
}

async function fetchManifest(): Promise<Manifest> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS)
  try {
    const response = await request(MANIFEST_URL, {
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
      throw new Error('the update manifest is not valid')
    }

    return { ...body, size: Number(body.size) || 0 } as Manifest
  } finally {
    clearTimeout(timer)
  }
}

/**
 * One immediate retry for anything that is not a plain 4xx.
 *
 * A first request on a cold network routinely loses its TLS handshake or waits
 * out the first byte; a second attempt a moment later almost never does.
 */
async function fetchManifestWithRetry(): Promise<Manifest> {
  try {
    return await fetchManifest()
  } catch (error) {
    if (/HTTP 4\d\d/i.test(technical(error))) throw error
    console.warn('[updates] manifest attempt failed, retrying once', technical(error))
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    return fetchManifest()
  }
}

/** Streams the payload to disk, reporting progress, and proves what arrived. */
async function downloadPayload(manifest: Manifest): Promise<string> {
  const target = join(payloadDir(), `${manifest.file}.part`)
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
    const response = await request(manifestUrl(manifest), {
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

  const final = join(payloadDir(), manifest.file)
  await rm(final, { force: true })
  await rename(target, final)
  return manifest.file
}

export async function checkForUpdates(manual = false): Promise<UpdateState> {
  if (!packaged) return updateState()
  if (running) return updateState()

  // Never interrupt a download that is already under way.
  if (state.phase === 'downloading' || state.phase === 'ready') return updateState()

  running = true
  lastAttempt = Date.now()
  setState({ phase: 'checking', message: manual ? 'Checking for updates…' : null, detail: null })

  try {
    const manifest = await fetchManifestWithRetry()
    const current = runningVersion()

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
    const pending = readPending()
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

    const file = await downloadPayload(manifest)
    writePending({ version: manifest.version, file, sha256: manifest.sha256, size: manifest.size })

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

    // Ask where it broke before apologising, so the panel can say something
    // specific. Never let the diagnosis become the failure.
    let verdict: string | null = null
    let detail = technical(error)
    try {
      const diagnosis = await diagnose()
      verdict = diagnosis.verdict
      detail = `${detail} — ${diagnosis.text}`
    } catch {
      /* the diagnosis is a courtesy, not a requirement */
    }

    // A specific verdict only replaces the apology, never a real explanation.
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
  }
}

/**
 * Applying an update is a restart.
 *
 * The payload is already on disk and verified; the bootstrap loads it on the
 * way up. Nothing is spawned, nothing is installed, and a cancelled restart
 * changes nothing.
 */
export function installUpdate(): UpdateState {
  if (state.phase !== 'ready') return updateState()

  setImmediate(() => {
    app.relaunch()
    app.exit(0)
  })

  return updateState()
}

/** Called when the window regains focus — at most once an hour. */
export function checkForUpdatesOnFocus(): void {
  if (!packaged) return
  if (Date.now() - lastAttempt < FOCUS_CHECK_AFTER_MS) return
  if (state.phase === 'downloading' || state.phase === 'ready' || state.phase === 'checking') return
  void checkForUpdates(false)
}

/** Called once at startup, after the database and IPC are ready. */
export function initUpdates(): void {
  if (!packaged) return

  // A payload downloaded in a previous session is already in place: the
  // bootstrap is running it, so report that rather than looking for it again.
  const pending = readPending()
  if (pending) {
    setState({
      phase: 'ready',
      version: pending.version,
      percent: 100,
      canInstall: true,
      message: `Version ${pending.version} is ready. Restart to apply it.`
    })
  }

  firstCheck = setTimeout(() => void checkForUpdates(false), FIRST_CHECK_DELAY_MS)
  firstCheck.unref()

  interval = setInterval(() => void checkForUpdates(false), CHECK_INTERVAL_MS)
  interval.unref()
}
