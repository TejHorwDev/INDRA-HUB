/*
 * The only door between the installer's page and the machine.
 *
 * The page can ask five things and nothing else: what version this is, where
 * the background film is (a path the main process chose, never one the page
 * supplied), to minimise or close the window, to install with one of two scopes,
 * and to finish by launching the app. No filesystem, no shell, no arbitrary
 * command, no arbitrary path.
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
