import { app, ipcMain, shell } from 'electron'
import { runningVersion } from '../lib/payload'
import { currentSession, login, logout } from '../services/auth'
import {
  checkForUpdates,
  diagnoseConnection,
  installUpdate,
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

  /*
   * Links open in the real browser, and only https links do. The renderer cannot
   * ask for anything else, and a `file:` or `javascript:` URL is dropped here
   * rather than handed to the shell.
   */
  ipcMain.handle('links:open', async (_event, url: unknown) => {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return
    await shell.openExternal(url)
  })

  ipcMain.on('window:close', handlers.closeWindow)
  ipcMain.on('window:minimize', handlers.minimizeWindow)
}
