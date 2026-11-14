/*
 * The only door between the installer's page and the machine.
 *
 * The page can ask six things and nothing else: what version this is, where the
 * background film is, the default install folders, the system folder picker, to
 * minimise or close the window, to install with a scope and a folder, and to
 * finish by launching the app. The folder it passes back is checked again in the
 * main process. No filesystem, no shell, no arbitrary command.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('setup', {
  version: () => ipcRenderer.invoke('setup:version'),

  /**
   * `background()` — a `file://` URL for the film, or null when this build has
   * none. The path is resolved by the main process because the file ships
   * beside the app, outside the archive the page is loaded from.
   */
  background: () => ipcRenderer.invoke('setup:background'),

  /** `defaults()` — the folder the window starts with, per scope. */
  defaults: () => ipcRenderer.invoke('setup:defaults'),

  /**
   * `chooseFolder(suggested)` — opens the system folder picker and resolves to
   * the chosen path, or null. The page may suggest a starting folder; the
   * choice itself is the dialog's.
   */
  chooseFolder: (suggested) => ipcRenderer.invoke('setup:choose-folder', suggested),
  minimise: () => ipcRenderer.invoke('setup:minimise'),
  close: () => ipcRenderer.invoke('setup:close'),

  install: (options) => ipcRenderer.invoke('setup:install', options),

  /** `finish({ launch })` — closes the window, opening the app if asked. */
  finish: (payload) => ipcRenderer.invoke('setup:finish', payload),

  onProgress: (listener) => {
    // One channel, and the listener only ever receives a plain object.
    ipcRenderer.on('setup:progress', (_event, payload) => listener(payload))
  }
})
