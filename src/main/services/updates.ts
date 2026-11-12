import { app, BrowserWindow } from 'electron'
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
 * pick up at the next start. No installer is downloaded and no downloaded
 * executable is ever run: applying an update is a restart.
 *
 * The installer still exists, but only for the first install on a machine.
 */

const MANIFEST_URL = 'https://github.com/TejHorwDev/INDRA-HUB/releases/latest/download/payload.json'
const FIRST_CHECK_DELAY_MS = 3_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const FOCUS_CHECK_AFTER_MS = 60 * 60 * 1000
const MANIFEST_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const STALL_TIMEOUT_MS = 45_000
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
let lastAttempt = 0
let running = false

let state: UpdateState = {
  phase: packaged ? 'idle' : 'unsupported',
  currentVersion: runningVersion(),
  version: null,
  percent: 0,
  bytesPerSecond: 0,
  message: packaged ? null : 'Updates only run in the installed app, not in development.',
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

function friendlyError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)

  if (/HTTP 404|not found/i.test(text)) {
    return 'No in-app update was published for this release yet. Try again later.'
  }
  if (/HTTP 403|rate limit/i.test(text)) {
    return 'GitHub is refusing requests for now. Try again later.'
  }
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|getaddrinfo|net::|fetch failed/i.test(text)) {
    return 'The update server could not be reached. Check the connection and try again.'
  }
  if (/checksum|size/i.test(text)) {
    return 'The downloaded update was damaged and has been discarded. It will be tried again later.'
  }
  return 'The update could not be checked. Try again later.'
}

function manifestUrl(manifest: Manifest): string {
  if (manifest.url) return manifest.url
  return `https://github.com/TejHorwDev/INDRA-HUB/releases/latest/download/${manifest.file}`
}

async function fetchManifest(): Promise<Manifest> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS)
  try {
    const response = await fetch(MANIFEST_URL, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'cache-control': 'no-cache' }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = (await response.json()) as Partial<Manifest>
    if (
      typeof body.version !== 'string' ||
      typeof body.file !== 'string' ||
      typeof body.sha256 !== 'string' ||
      !/^[a-z0-9]{64}$/i.test(body.sha256) ||
      !body.file.toLowerCase().endsWith('.asar')
    ) {
      throw new Error('the update manifest is not valid')
    }
    return { ...body, size: Number(body.size) || 0 } as Manifest
  } finally {
    clearTimeout(timer)
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
    const response = await fetch(manifestUrl(manifest), {
      signal: controller.signal,
      redirect: 'follow'
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
  setState({ phase: 'checking', message: manual ? 'Checking for updates…' : null })

  try {
    const manifest = await fetchManifest()
    const current = runningVersion()

    if (compareVersions(manifest.version, current) <= 0) {
      setState({
        phase: 'up-to-date',
        version: null,
        percent: 0,
        canInstall: false,
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
      checkedAt: new Date().toISOString(),
      message: `Version ${manifest.version} is ready. Restart to apply it.`
    })
    return updateState()
  } catch (error) {
    setState({
      phase: 'error',
      checkedAt: new Date().toISOString(),
      canInstall: false,
      message: friendlyError(error)
    })
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
