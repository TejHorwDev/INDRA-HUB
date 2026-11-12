import { app, BrowserWindow } from 'electron'
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater'
import type { UpdateState } from '@shared/types'

/*
 * Self-update.
 *
 * An installed build checks the published release feed as it starts — the
 * check is part of opening the app, not something the user has to ask for —
 * and again when the window regains focus (at most hourly) and every few hours
 * regardless. A newer version downloads in the background and waits: the user
 * is only ever asked to restart, never forced to.
 *
 * The updater lives in the main process because it must write to the app's
 * install directory. The renderer only ever sees `UpdateState`.
 */

const STATE_CHANNEL = 'update:state'
/** Long enough for the window and first paint; part of every launch. */
const FIRST_CHECK_DELAY_MS = 3_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
/** A focus check is a bonus, not a poll — once an hour at most. */
const FOCUS_CHECK_AFTER_MS = 60 * 60 * 1000

const packaged = app.isPackaged

let updater: AppUpdater | null = null
let firstCheck: NodeJS.Timeout | null = null
let interval: NodeJS.Timeout | null = null
let lastAttempt = 0

let state: UpdateState = {
  phase: packaged ? 'idle' : 'unsupported',
  currentVersion: app.getVersion(),
  version: null,
  percent: 0,
  bytesPerSecond: 0,
  message: packaged ? null : 'Self-update only runs in an installed build, not in development.',
  checkedAt: null,
  canCheck: packaged,
  canInstall: false
}

function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(STATE_CHANNEL, state)
  }
}

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  broadcast()
}

export function updateState(): UpdateState {
  return state
}

/** Turns network and feed failures into something a person can act on. */
function friendlyError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)

  if (/\b404\b|not found|cannot find latest|ENOENT/i.test(text)) {
    return 'No update feed was found at the release address. The repository that publishes releases must be publicly readable.'
  }
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|getaddrinfo|net::/i.test(text)) {
    return 'The update server could not be reached. Check the connection and try again.'
  }
  if (/code signature|publisher/i.test(text)) {
    return 'The downloaded update failed its signature check and was discarded.'
  }
  return 'The update could not be checked. Try again later.'
}

function ensureUpdater(): AppUpdater | null {
  if (!packaged) return null
  if (updater) return updater

  try {
    // Loaded lazily so a development session never pulls in the updater.
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')

    // Download on its own, then wait for a restart. Never install under the
    // user's hands mid-edit.
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.logger = console

    autoUpdater.on('checking-for-update', () => {
      setState({ phase: 'checking', message: null })
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      setState({
        phase: 'available',
        version: info.version,
        percent: 0,
        canInstall: false,
        message: `Version ${info.version} is downloading in the background.`
      })
    })

    autoUpdater.on('update-not-available', () => {
      setState({
        phase: 'up-to-date',
        version: null,
        percent: 0,
        canInstall: false,
        checkedAt: new Date().toISOString(),
        message: 'You are on the newest version.'
      })
    })

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      setState({
        phase: 'downloading',
        percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
        bytesPerSecond: Math.max(0, Math.round(progress.bytesPerSecond))
      })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      setState({
        phase: 'ready',
        version: info.version,
        percent: 100,
        canInstall: true,
        checkedAt: new Date().toISOString(),
        message: `Version ${info.version} is ready. Restart to install it.`
      })
    })

    autoUpdater.on('error', (error: Error) => {
      setState({
        phase: 'error',
        message: friendlyError(error),
        canInstall: state.phase === 'ready'
      })
    })

    updater = autoUpdater
    return updater
  } catch (error) {
    console.error('[updates] updater unavailable', error)
    setState({
      phase: 'unsupported',
      canCheck: false,
      canInstall: false,
      message: 'The updater component is missing from this build.'
    })
    return null
  }
}

export async function checkForUpdates(manual = false): Promise<UpdateState> {
  const instance = ensureUpdater()
  if (!instance) return state

  // Never interrupt a download that is already under way.
  if (state.phase === 'downloading' || state.phase === 'ready') return state

  lastAttempt = Date.now()
  setState({
    phase: 'checking',
    message: manual ? 'Checking for updates…' : null
  })

  try {
    await instance.checkForUpdates()
  } catch (error) {
    setState({
      phase: 'error',
      checkedAt: new Date().toISOString(),
      message: friendlyError(error)
    })
  }

  return state
}

export function installUpdate(): UpdateState {
  if (!updater || state.phase !== 'ready') return state

  // Let the IPC reply reach the renderer before the window disappears.
  setImmediate(() => {
    try {
      // The first argument is `isSilent`. Passing false here ran the NSIS
      // wizard in front of the user — which is exactly the "it downloaded an
      // installer and ran it" experience this app is not supposed to have.
      // Silent install replaces the files and relaunches into the new version;
      // the user sees a restart, not an installer.
      updater?.quitAndInstall(true, true)
    } catch (error) {
      console.error('[updates] install failed', error)
      setState({ phase: 'error', message: 'The update could not be installed. Restart the app and try again.' })
    }
  })

  return state
}

/**
 * Called when the window regains focus — someone who left the app open all day
 * should not have to find the Updates panel to learn a release exists.
 */
export function checkForUpdatesOnFocus(): void {
  if (!packaged) return
  if (Date.now() - lastAttempt < FOCUS_CHECK_AFTER_MS) return
  if (state.phase === 'downloading' || state.phase === 'ready' || state.phase === 'checking') return
  void checkForUpdates(false)
}

/** Called once at startup, after the database and IPC are ready. */
export function initUpdates(): void {
  if (!packaged) return
  if (!ensureUpdater()) return

  firstCheck = setTimeout(() => void checkForUpdates(false), FIRST_CHECK_DELAY_MS)
  firstCheck.unref()

  interval = setInterval(() => void checkForUpdates(false), CHECK_INTERVAL_MS)
  interval.unref()
}
