import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from 'electron'
import { join } from 'node:path'
import { closeDatabase, getDatabase } from './db/database'
import { registerIpcHandlers } from './ipc'
import { markHealthy, runningVersion } from './lib/payload'
import { ensureBuiltInAdmin, resetAdminIdentity } from './services/admin'
import {
  ensureBuiltInWorkspace,
  startWorkspaceSync,
  stopWorkspaceSync
} from './services/workspace'
import { checkForUpdatesOnFocus, initUpdates } from './services/updates'
import {
  recheckConnectivity,
  startConnectivity,
  stopConnectivity
} from './services/connectivity'

const isDev = !app.isPackaged

/*
 * One instance owns the database.
 *
 * SQLite tolerates two writers, but two copies of the app mean two windows
 * editing the same documents with no idea about each other — and the updater
 * replacing files under a live process. The second launch just focuses the
 * first.
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

/** Keeps the window background in step with the theme so resizes never flash white. */
/**
 * The colour the window is painted before the renderer has drawn anything.
 * It matches --bg in both themes (matte black and the light canvas), so the
 * first frame does not flash a shade that is about to be replaced.
 */
function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#0a0a0b' : '#f4f4f5'
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 660,
    show: false,
    // Frameless: INDRA HUB draws its own top bar in a later build.
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 18, y: 20 },
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // Coming back to the app is a natural moment to ask whether it is still
  // connected and whether it is current.
  mainWindow.on('focus', () => {
    recheckConnectivity()
    checkForUpdatesOnFocus()
  })

  // External links never open inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  /*
   * Navigation guard.
   *
   * The app is a single page. A link inside a document must open in the real
   * browser, never replace the app shell — otherwise one click leaves the user
   * staring at a web page with no way back, and the window is no longer the
   * thing the IPC surface was designed for.
   */
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  mainWindow.webContents.on('will-navigate', (event, target) => {
    const internal = devServerUrl
      ? target.startsWith(devServerUrl)
      : target.startsWith('file://') && target.includes('/renderer/index.html')
    if (internal) return
    event.preventDefault()
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target)
  })

  // The renderer draws its own title bar, so it owns the window controls.
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:state', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:state', false))

  nativeTheme.on('updated', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(windowBackground())
    }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.indra.hub')

  // Open (and migrate) the database before any IPC call can reach it.
  getDatabase()

  /*
   * The shared workspace: put the compiled-in endpoint in place when this
   * installation has never been configured, then start mirroring the row.
   * A fresh install therefore inherits the administrator's switches — and the
   * sign-in background — without anyone having to set anything up on it.
   */
  ensureBuiltInWorkspace()
  startWorkspaceSync()

  // Know whether this machine has a route out, and tell the windows when that
  // changes. Nothing else in the app waits for the answer.
  startConnectivity()

  // A fresh installation has exactly one administrator, created here — before
  // any window exists, so nothing has to offer to create one.
  ensureBuiltInAdmin()

  registerIpcHandlers()

  /*
   * Offline recovery: `INDRA HUB --reset-admin`.
   *
   * Deliberately not a button. There is one administrator and no default
   * credential, so a forgotten password would otherwise lock the installation
   * for good. Recovering needs command-line access to the machine — the same
   * bar as opening the database file — and it removes the administrator
   * identity only. Projects, documents, accounts and keys are untouched.
   */
  if (process.argv.includes('--reset-admin')) {
    const { reset } = resetAdminIdentity()
    void dialog.showMessageBox({
      type: 'info',
      title: 'Administrator access',
      message: reset
        ? 'Administrator access was reset. Set up a new administrator now.'
        : 'There was no administrator to reset. Set one up now.',
      detail: reset
        ? 'Your projects, documents, accounts and activation keys were not touched.'
        : 'This installation had no administrator configured.',
      buttons: ['Continue']
    })
  }

  // Reaching this point means the payload we are running actually works, so
  // it stops being on probation and will be used again next time.
  markHealthy()

  // An installed build looks for a newer release in the background.
  initUpdates()

  // Window controls. Every handler resolves the window from its own sender so
  // no renderer can drive a window it does not belong to.
  const senderWindow = (event: Electron.IpcMainEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender)

  ipcMain.on('window:minimize', (event) => senderWindow(event)?.minimize())

  ipcMain.on('window:toggle-maximize', (event) => {
    const window = senderWindow(event)
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  ipcMain.on('window:close', (event) => senderWindow(event)?.close())

  ipcMain.handle('window:is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  // The payload's version when an in-app update is running, not the
  // installer's.
  ipcMain.handle('app:version', () => runningVersion())

  // Locked-down content policy for the packaged app; dev keeps Vite's HMR working.
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' blob:; font-src 'self' data:"
          ]
        }
      })
    })
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopConnectivity()
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  stopWorkspaceSync()
  closeDatabase()
})
