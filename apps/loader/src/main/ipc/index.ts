import { app, ipcMain, shell } from 'electron'
import { installed } from '../services/installed'
import { runningVersion } from '../lib/payload'
import { currentSession, login, logout, restoreSession } from '../services/auth'
import { rememberVideo } from '../lib/backdrop-cache'
import { loadCatalogue } from '../services/catalog'
import { entitlementReport, ownedProductIds } from '../services/entitlement'
import { cancelDownload, startDownload, states, uninstall } from '../services/downloads'
import { launch } from '../services/launch'
import {
  checkForUpdates,
  diagnoseConnection,
  installUpdate,
  noteActivity,
  noteScreen,
  updateLog,
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
  // A press is not a loop: a person asking clears any guard that was holding back
  // an automatic restart. See `installUpdate`.
  ipcMain.handle('update:install', () => installUpdate({ manual: true }))
  ipcMain.handle('update:diagnose', () => diagnoseConnection())
  ipcMain.handle('update:log', () => updateLog())
  ipcMain.on('update:screen', (_event, screen: unknown) => {
    if (typeof screen === 'string') noteScreen(screen)
  })
  /*
   * What the window is doing — the screen, and whether a field has focus or text in
   * it. Reported on every focus change, so the updater can restart the moment
   * nobody is in the middle of anything.
   */
  ipcMain.on('update:activity', (_event, activity: unknown) => {
    if (!activity || typeof activity !== 'object') return
    const report = activity as { screen?: unknown; typing?: unknown }
    noteActivity({
      screen: typeof report.screen === 'string' ? report.screen : undefined,
      typing: report.typing === true
    })
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
  /*
   * The session from the last run. Asked once as the window comes up: if the token
   * the OS decrypts still works, the app opens into the library instead of a
   * password box — which is what makes an update restart invisible.
   */
  ipcMain.handle('auth:restore', () => restoreSession())

  // The catalogue and its links. Public data, fetched in the main process so the
  // renderer still has no network of its own.
  ipcMain.handle('catalogue:load', async () => {
    const catalogue = await loadCatalogue()
    // The launch card cannot fetch, so every read leaves a note for next time.
    rememberVideo(catalogue.config.video)
    return catalogue
  })
  ipcMain.handle('auth:probe', () => entitlementReport())
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
