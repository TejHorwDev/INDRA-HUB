import { app, ipcMain, shell } from 'electron'
import { installed } from '../services/installed'
import { runningVersion } from '../lib/payload'
import { currentSession, login, logout } from '../services/auth'
import { loadCatalogue } from '../services/catalog'
import { ownedProductIds } from '../services/entitlement'
import { cancelDownload, startDownload, states, uninstall } from '../services/downloads'
import { launch } from '../services/launch'
import {
  checkForUpdates,
  diagnoseConnection,
  installUpdate,
  noteScreen,
  updateState
} from '../services/updates'

/*
 * The whole IPC surface, in one place.
 *
 * Every channel is named here and nowhere else, so the preload bridge and the
 * main process cannot drift apart without the type checker noticing. Nothing
 * handles a path, a URL or a token from the renderer: the renderer asks for
 * outcomes, not for capabilities.
 */

interface Handlers {
  closeWindow: () => void
  minimizeWindow: () => void
}

export function registerIpc(handlers: Handlers): void {
  ipcMain.handle('app:version', () => ({
    running: runningVersion(),
    installed: app.getVersion(),
    packaged: app.isPackaged
  }))

  ipcMain.handle('update:state', () => updateState())
  ipcMain.handle('update:check', () => checkForUpdates(true))
  ipcMain.handle('update:install', () => installUpdate())
  ipcMain.handle('update:diagnose', () => diagnoseConnection())
  ipcMain.on('update:screen', (_event, screen: unknown) => {
    if (typeof screen === 'string') noteScreen(screen)
  })

  // The token stays in the main process; the renderer only learns who is signed
  // in.
  ipcMain.handle('auth:login', (_event, username: unknown, password: unknown) => {
    if (typeof username !== 'string' || typeof password !== 'string') {
      return { ok: false, error: 'Enter username & password' }
    }
    return login(username, password)
  })
  ipcMain.handle('auth:logout', () => logout())
  ipcMain.handle('auth:session', () => currentSession())

  // The catalogue and its links. Public data, fetched in the main process so the
  // renderer still has no network of its own.
  ipcMain.handle('catalogue:load', () => loadCatalogue())
  ipcMain.handle('auth:owned', () => ownedProductIds())

  /*
   * Links open in the real browser, and only https links do. The renderer cannot
   * ask for anything else, and a `file:` or `javascript:` URL is dropped here
   * rather than handed to the shell.
   */
  ipcMain.handle('links:open', async (_event, url: unknown) => {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return
    await shell.openExternal(url)
  })

  /* ------------------------------------------------------------------ files */

  ipcMain.handle('files:states', () => states())
  ipcMain.handle('files:download', (_event, id: unknown) =>
    typeof id === 'string' ? startDownload(id) : Promise.reject(new Error('bad id'))
  )
  ipcMain.handle('files:cancel', (_event, id: unknown) =>
    typeof id === 'string' ? cancelDownload(id) : Promise.reject(new Error('bad id'))
  )
  ipcMain.handle('files:uninstall', (_event, id: unknown) =>
    typeof id === 'string' ? uninstall(id) : Promise.reject(new Error('bad id'))
  )
  ipcMain.handle('files:launch', (_event, id: unknown) =>
    typeof id === 'string' ? launch(id) : { ok: false, error: 'bad id' }
  )
  ipcMain.handle('files:reveal', (_event, id: unknown) => {
    if (typeof id !== 'string') return
    // Only a path this app recorded, never one the renderer supplied.
    const entry = installed(id)
    if (entry) shell.showItemInFolder(entry.exe)
  })

  ipcMain.on('window:close', handlers.closeWindow)
  ipcMain.on('window:minimize', handlers.minimizeWindow)
}
