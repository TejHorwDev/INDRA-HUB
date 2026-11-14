import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { LAUNCH_HOLD, isForward, stageForPhase, type LaunchStage } from './launch-stages'
import { checkForUpdates, installUpdate, updateState } from './services/updates'

/*
 * The launch window.
 *
 * A small dark card, one ring, one sentence — checking, downloading, restarting
 * — and only then the app. It is the same shape as the sign-in spinner on
 * purpose: a person waiting for this app sees one kind of waiting everywhere.
 *
 * Three rules make it safe to put before the real window:
 *
 *   1. It never blocks the app. A check that fails, or takes longer than the
 *      grace period, closes the card and opens INDRA HUB. Offline still works.
 *   2. It restarts rather than asking. An update found at launch is downloaded,
 *      proved, and applied by relaunching — the payload is already on disk and
 *      verified before the restart, so a failed restart changes nothing.
 *   3. Every stage is held for a readable moment even when the work is instant.
 *      A 1.5 MB payload downloads in under a second; a sentence that appears and
 *      vanishes in 80 ms reads as a flicker, not as progress.
 */

/** The card's size. Small on purpose — this is a launcher, not a page. */
const WIDTH = 336
const HEIGHT = 392

/** Past this, the app opens and the download finishes in the background. */
const GRACE_MS = 10_000

/**
 * What the caller should do next.
 *
 * `restarting` means the process is about to relaunch into a new payload and no
 * app window should be shown; `card` is the launch window, which the caller owns
 * and must close once the real window is on screen.
 */
export interface LaunchResult {
  card: BrowserWindow | null
  restarting: boolean
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function createSplashWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    center: true,
    title: 'INDRA HUB',
    backgroundColor: '#00000000',
    // Dark card in either theme: the launch window is its own surface, like
    // Discord's, and never flashes the light canvas before the card paints.
    webPreferences: {
      preload: join(__dirname, '../preload/splash.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false
    }
  })

  window.setMenuBarVisibility(false)
  window.once('ready-to-show', () => window.show())

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(`${devServerUrl}/splash.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/splash.html'))
  }

  return window
}

/**
 * Runs the launch sequence, then resolves.
 *
 * The caller opens the real window when this resolves — no matter how it
 * resolved. Restarting never resolves: `installUpdate` relaunches the process.
 */
export async function runLaunchSplash(): Promise<LaunchResult> {
  if (!app.isPackaged) return { card: null, restarting: false }

  const splash = createSplashWindow()
  let stage: Exclude<LaunchStage, 'done'> = 'checking'
  let since = Date.now()

  /* Wait for the card to be on screen before saying anything, so the first
   * sentence is read, not missed. A page that never reports still cannot hold
   * the app hostage. */
  const painted = new Promise<void>((resolve) => {
    const onReady = (event: Electron.IpcMainEvent): void => {
      if (event.sender === splash.webContents) resolve()
    }
    ipcMain.on('launch:ready', onReady)
    splash.once('closed', () => ipcMain.removeListener('launch:ready', onReady))
    setTimeout(resolve, 1500)
  })

  const send = (next: Exclude<LaunchStage, 'done'>): void => {
    if (splash.isDestroyed()) return
    stage = next
    since = Date.now()
    splash.webContents.send('launch:stage', next)
  }

  /** Switches stage, but never sooner than the previous one has been read. */
  const moveTo = async (next: Exclude<LaunchStage, 'done'>): Promise<void> => {
    if (stage === next) return
    if (!isForward(stage, next)) return
    const remaining = LAUNCH_HOLD[stage] - (Date.now() - since)
    if (remaining > 0) await delay(remaining)
    send(next)
  }

  const started = Date.now()

  try {
    await painted
    await delay(LAUNCH_HOLD.checking)

    /* The check runs in the background service, so Settings shows the same
     * result and a download that outlives this window is still tracked. */
    const check = checkForUpdates(false)
    void check.catch(() => undefined)

    for (;;) {
      const next = stageForPhase(updateState().phase)

      if (next === 'downloading') {
        await moveTo('downloading')
      }

      if (next === 'restarting') {
        await moveTo('restarting')
        await delay(LAUNCH_HOLD.restarting)
        installUpdate()
        return { card: splash, restarting: true }
      }

      if (next === 'done') break
      if (Date.now() - started > GRACE_MS) break
      await delay(120)
    }
  } catch (error) {
    /* A launch screen must never be the reason someone cannot open the app. */
    console.error('[launch] update check failed', error)
  } finally {
    /*
     * Fade the card out and leave the window alive.
     *
     * Destroying it here was the launch bug: with no other window yet, the
     * destroy made this the last window, `window-all-closed` fired, and the app
     * quit before the real window existed. The caller closes this one after the
     * app is on screen — by then there is another window, so nothing quits.
     */
    if (!splash.isDestroyed()) {
      splash.webContents.send('launch:stage', 'closing')
      await delay(180)
      splash.hide()
    }
  }

  return { card: splash, restarting: false }
}
