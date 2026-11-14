import { BrowserWindow, app, ipcMain } from 'electron'
import { join } from 'node:path'
import { LAUNCH_HOLD, isForward, stageForPhase, type LaunchStage } from './launch-stages'
import { cachedVideo, rememberVideo } from './lib/backdrop-cache'
import { ensureFilm, filmSource } from './lib/film'
import { APP_NAME } from './lib/identity'
import { readConfig } from './services/catalog'
import { checkForUpdates, installUpdate, noteScreen, updateState } from './services/updates'

/*
 * The launch card.
 *
 * A small dark card, one ring, one sentence — checking, downloading, restarting —
 * and only then the app. Same shape as the hub's, because a person who owns both
 * should not have to learn two kinds of waiting.
 *
 * Three rules make it safe to put in front of the real window:
 *
 *   1. It never blocks the app. A check that fails, or takes longer than the
 *      grace period, closes the card and opens the loader. Offline still works.
 *   2. It restarts rather than asking. An update found at launch is downloaded,
 *      proved, and applied by relaunching — the payload is on disk and verified
 *      before the restart, so a failed restart changes nothing.
 *   3. Every stage is held for a readable moment even when the work is instant.
 *      A 0.3 MB payload downloads in under a second; a sentence that appears and
 *      vanishes in 80ms reads as a flicker, not as progress.
 */

const WIDTH = 340
const HEIGHT = 300

/*
 * How long the card may hold the app, per stage.
 *
 * It used to be one flat ten seconds for everything, which meant a check against a
 * sleeping panel — thirty to sixty seconds on a free instance — was abandoned while
 * it was still working, and a download that had barely started was abandoned with it.
 * The app then opened on the old build and nothing said why.
 *
 * A person watching a card that reads "Downloading update…" is not being kept
 * waiting; they are being told what is happening. A person watching a spinner for a
 * minute is. So: a check gets long enough to survive a cold start, a download gets as
 * long as it needs — three minutes of visible progress — and anything past either
 * budget closes the card and finishes in the background, exactly as before.
 */
/*
 * A cold host is not a failure.
 *
 * Thirty seconds was chosen when the panel was assumed warm. On the first launch of a
 * day it is not: a Render instance waking up plus a manifest fetch can cross half a
 * minute, and the card would close with the answer still in the air — the update then
 * arrived after the sign-in form was already up, which reads as "the update does not
 * work at first". Forty-five is still bounded, and the card is a spinner, not a hang.
 */
const CHECK_GRACE_MS = 45_000
const DOWNLOAD_GRACE_MS = 180_000

export interface LaunchResult {
  card: BrowserWindow | null
  /** The process is about to relaunch into a new payload: show no app window. */
  restarting: boolean
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function createCardWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    center: true,
    title: APP_NAME,
    backgroundColor: '#00000000',
    // The card is a surface of its own, like a launcher's: it never flashes the
    // page behind it before painting.
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
export async function runLaunchCard(): Promise<LaunchResult> {
  if (!app.isPackaged) return { card: null, restarting: false }

  /*
   * The card owns the startup update, so the silent-restart rule stands down.
   * Without this the card and `maybeAutoRestart` would both relaunch the process
   * for the same payload — and `splash` is an idle screen, which is exactly the
   * state that rule is looking for.
   */
  noteScreen('launch-card')

  const card = createCardWindow()
  let stage: Exclude<LaunchStage, 'done'> = 'checking'
  let since = Date.now()

  /* Wait for the card to be on screen before saying anything, so the first
   * sentence is read rather than missed. A page that never reports still cannot
   * hold the app hostage. */
  const painted = new Promise<void>((resolve) => {
    const onReady = (event: Electron.IpcMainEvent): void => {
      if (event.sender !== card.webContents) return
      /*
       * The film the panel published last time, handed over the moment the page
       * exists. The card cannot wait for a network call — it is the first thing
       * anybody sees — but it can start with what it already knows and be
       * corrected a second later if the answer has changed.
       */
      const remembered = cachedVideo()
      // From the disk when it is there. The card is the first thing anybody sees, and a
      // card that waits for a bucket is a card that shows nothing.
      const source = remembered ? filmSource(remembered) : null
      if (source) card.webContents.send('launch:video', source)
      resolve()
    }
    ipcMain.on('launch:ready', onReady)
    card.once('closed', () => ipcMain.removeListener('launch:ready', onReady))
    setTimeout(resolve, 1500)
  })

  /*
   * A cheap look at the published config while the update check runs. If the film
   * changed since the last launch, the card swaps to it. If this fails, the card
   * keeps the remembered one and nobody ever knows.
   */
  void readConfig(2500)
    .then((config) => {
      const film = config.video.trim()
      if (!film) return
      // Fetch it for every launch after this one, whether or not it changed.
      void ensureFilm(film)
      if (film === cachedVideo()) {
        // Same film: still show it, from somewhere that does not need the network.
        const source = filmSource(film)
        if (source && !card.isDestroyed()) card.webContents.send('launch:video', source)
        return
      }
      rememberVideo(film)
      if (!card.isDestroyed()) card.webContents.send('launch:video', film)
    })
    .catch(() => undefined)

  const send = (next: Exclude<LaunchStage, 'done'>): void => {
    if (card.isDestroyed()) return
    stage = next
    since = Date.now()
    card.webContents.send('launch:stage', next)
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

  /** When the updater last changed phase, so each stage gets its own budget. */
  let phase = updateState().phase
  let phaseSince = started

  try {
    await painted
    await delay(LAUNCH_HOLD.checking)

    // The check runs in the background service, so Settings shows the same
    // result and a download that outlives this card is still tracked.
    void checkForUpdates(false).catch(() => undefined)

    for (;;) {
      const now = updateState().phase
      if (now !== phase) {
        phase = now
        phaseSince = Date.now()
      }

      const next = stageForPhase(now)

      if (next === 'downloading') await moveTo('downloading')

      if (next === 'restarting') {
        await moveTo('restarting')
        await delay(LAUNCH_HOLD.restarting)
        /*
         * The restart can be refused — a payload that failed to start last time is
         * not tried again. Claiming `restarting` after a refusal would mean no window
         * is ever opened, so the answer is read back rather than assumed.
         */
        const after = installUpdate()
        if (after.phase === 'error') break
        return { card, restarting: true }
      }

      if (next === 'done') break

      /*
       * Downloading is the one stage worth waiting out: the work is visible, it ends
       * on its own, and the alternative is a restart the person has to perform.
       */
      const budget = now === 'available' || now === 'downloading' ? DOWNLOAD_GRACE_MS : CHECK_GRACE_MS
      if (Date.now() - phaseSince > budget) break
      await delay(120)
    }
  } catch (error) {
    // A launch card must never be the reason someone cannot open the app.
    console.error('[launch] update check failed', error)
  } finally {
    /*
     * Fade the card out and leave the window alive.
     *
     * Destroying it here is the launch bug the hub already paid for: with no
     * other window yet, the destroy makes this the last window,
     * `window-all-closed` fires, and the app quits before the real window
     * exists. The caller closes this one after the app is on screen.
     */
    if (!card.isDestroyed()) {
      card.webContents.send('launch:stage', 'closing')
      await delay(180)
      card.hide()
    }
  }

  return { card, restarting: false }
}
