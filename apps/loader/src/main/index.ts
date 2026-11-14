import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'node:path'
import { APP_NAME, applyIdentity } from './lib/identity'
import { clearCacheOnUpdate } from './lib/cache-version'
import { markHealthy } from './lib/payload'
import { forgetStoredSession } from './services/auth'
import { registerIpc } from './ipc'
import { checkForUpdatesOnFocus, initUpdates } from './services/updates'
import { startWithLaunchCard } from './launch'
import { runLaunchCard } from './splash'

/*
 * INDRA LOADER.
 *
 * A 900x550 fixed window that draws its own frame: frameless, transparent only
 * at the four corner arcs, radius 18. The app is a single page, so there is one
 * BrowserWindow and it is created once.
 *
 * The installed app opens behind a launch card — the small dark window that says
 * what the updater is doing, the same one the hub shows — and the card is closed
 * only once the app is on screen. See `launch.ts` for why the order matters.
 */

// Before anything reads a path or groups a taskbar button.
applyIdentity()

const isDev = !app.isPackaged

/*
 * One instance.
 *
 * Two copies would mean two windows over the same sign-in and, worse, the
 * updater replacing a payload under a live process. The second launch focuses
 * the first. The lock is keyed on the userData folder, which is why INDRA HUB
 * and INDRA LOADER can both run at once.
 */
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
}

app.on('second-instance', () => {
  const [existing] = BrowserWindow.getAllWindows()
  if (!existing) return
  if (existing.isMinimized()) existing.restore()
  existing.show()
  existing.focus()
})

let mainWindow: BrowserWindow | null = null

/*
 * The renderer may load its own bundled files and nothing else.
 *
 * `connect-src 'none'` is the important line: this app makes no network requests
 * from the renderer at all. Every request — auth, catalogue, downloads, updates —
 * happens in the main process, so a compromised renderer has no network to
 * reach and no token to steal.
 *
 * Sent as a header rather than a <meta> tag, so it cannot be sidestepped by
 * markup injected later. Skipped against the dev server, which needs a websocket
 * and an inline preamble to hot-reload — and which is never what ships.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // Product images are served from the storage bucket; nothing else is remote.
  "img-src 'self' data: https:",
  // The sign-in film, served from the panel's storage. `https:` because the
  // admin panel sets it and it lives in a bucket, not in the installer.
  "media-src 'self' blob: https:",
  "font-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

function applyContentSecurityPolicy(): void {
  if (process.env['ELECTRON_RENDERER_URL']) return

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY]
      }
    })
  })
}

function createWindow(options: { deferred?: boolean } = {}): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 550,
    // Fixed size: the layout is a composition, not a fluid document. A resize
    // handle would only let a user break it.
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    frame: false,
    // Transparent for the 18px corner arcs and nothing else — the panel itself
    // is opaque, so no desktop shows through.
    transparent: true,
    backgroundColor: '#00000000',
    title: APP_NAME,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Nothing in this app needs the camera, the microphone or a location.
      webSecurity: true,
      spellcheck: false
    }
  })

  /*
   * A deferred window is created before the launch card finishes and revealed by
   * the caller once the card is done. It must not show itself: the whole point is
   * that the card is what is on screen.
   */
  if (!options.deferred) mainWindow.once('ready-to-show', () => mainWindow?.show())

  // Coming back to the app is a natural moment to ask whether it is current.
  mainWindow.on('focus', () => checkForUpdatesOnFocus())

  // External links never open inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // A link inside the app must open in the real browser, never replace the
  // shell — otherwise one click leaves a user staring at a web page in a window
  // the IPC surface was never designed for.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  mainWindow.webContents.on('will-navigate', (event, target) => {
    const internal = devServerUrl
      ? target.startsWith(devServerUrl)
      : target.startsWith('file://') && target.includes('/renderer/index.html')
    if (internal) return
    event.preventDefault()
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target)
  })

  const devTools = process.env['INDRA_LOADER_DEVTOOLS'] === '1'
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // F12 opens devtools in development, and is swallowed in the installed app.
    if (input.key === 'F12' && input.type === 'keyDown') {
      event.preventDefault()
      if (isDev || devTools) mainWindow?.webContents.toggleDevTools()
    }
  })

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else if (options.deferred) {
    /*
     * `card=1` tells the renderer the launch card has already been the splash, so
     * it opens on the landing page instead of replaying its own two-second
     * opening. Two waits in a row is one wait too many.
     */
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { card: '1' } })
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

/** Shows the app window, whether or not it has finished loading. */
function revealWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return

  const show = (): void => {
    if (window.isDestroyed()) return
    window.show()
    window.focus()
  }

  // `ready-to-show` has already fired for a window that finished while the card
  // was up, so wait on it only while there is still something to wait for.
  if (window.webContents.isLoading()) window.once('ready-to-show', show)
  else show()
}

app.whenReady().then(async () => {
  /*
   * Healthy the moment the app is up, not five seconds later.
   *
   * The bootstrap gives a payload two starts to prove itself and `markHealthy`
   * forgave the attempts — but five seconds in, so closing the app quickly, twice,
   * was enough to have a perfectly good payload discarded and the app silently fall
   * back to the installed copy. That is one of the "sometimes it updates, sometimes
   * it does not" shapes: the update applied, then un-applied itself. Reaching here
   * at all means the payload loaded and its main process is running, which is what
   * "healthy" was always meant to mean.
   */
  markHealthy()

  /*
   * Before anything is fetched: a cache written by an older version is not trusted,
   * because the response format itself changed in 1.0.28 and nothing that is already on
   * disk can be repaired by the server.
   */
  await clearCacheOnUpdate()

  /*
   * A token from a release that remembered sessions is deleted, not ignored.
   * This build never reads it — which is exactly why it should not exist.
   */
  forgetStoredSession()

  applyContentSecurityPolicy()
  registerIpc({
    closeWindow: () => mainWindow?.close(),
    minimizeWindow: () => mainWindow?.minimize()
  })
  /*
   * A payload only counts as healthy once the app is genuinely up. The bootstrap
   * counted this start as an attempt; reaching here clears the count, so a
   * payload that works is never discarded for having failed before.
   */
  setTimeout(() => markHealthy(), 5_000)

  if (isDev) {
    // No card in development: there is no update to find, and a spinner before
    // Vite's server is ready would only be in the way.
    createWindow()
    setTimeout(() => initUpdates(), 2_000)
  } else {
    void startWithLaunchCard({
      createAppWindow: () => createWindow({ deferred: true }),
      runSplash: runLaunchCard,
      reveal: revealWindow,
      // If the app somehow never paints, showing it anyway beats leaving a
      // person with a card that has faded out.
      scheduleFallback: (reveal) => setTimeout(reveal, 6_000)
    })
      .then((window) => {
        // `null` means the process is relaunching into a new payload. No window.
        if (!window) return
        // The card has already asked; do not ask again two seconds later.
        initUpdates(true)
      })
      .catch((error) => {
        console.error('[launch] startup failed', error)
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
        initUpdates()
      })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
