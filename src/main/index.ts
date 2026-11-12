import { app, BrowserWindow, ipcMain, nativeTheme, session, shell } from 'electron'
import { join } from 'node:path'
import { closeDatabase, getDatabase } from './db/database'
import { registerIpcHandlers } from './ipc'

const isDev = !app.isPackaged

/** Keeps the window background in step with the theme so resizes never flash white. */
function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#101113' : '#f5f5f6'
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

  // External links never open inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
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
  registerIpcHandlers()

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

  ipcMain.handle('app:version', () => app.getVersion())

  // Locked-down content policy for the packaged app; dev keeps Vite's HMR working.
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:"
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
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  closeDatabase()
})
