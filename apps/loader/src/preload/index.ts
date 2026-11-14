import { contextBridge, ipcRenderer } from 'electron'
import type { UpdateDiagnostics, UpdateState } from '@shared/types'

/*
 * The only surface the renderer has.
 *
 * No token, no file path, no URL and no Electron object crosses this bridge —
 * the renderer can ask for state and request actions, and nothing else.
 */
const api = {
  version: (): Promise<{ running: string; installed: string; packaged: boolean }> =>
    ipcRenderer.invoke('app:version'),

  updates: {
    state: (): Promise<UpdateState> => ipcRenderer.invoke('update:state'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('update:check'),
    install: (): Promise<UpdateState> => ipcRenderer.invoke('update:install'),
    diagnose: (): Promise<UpdateDiagnostics> => ipcRenderer.invoke('update:diagnose'),
    onState: (listener: (state: UpdateState) => void): (() => void) => {
      const handler = (_event: unknown, state: UpdateState): void => listener(state)
      ipcRenderer.on('update:state', handler)
      return () => ipcRenderer.removeListener('update:state', handler)
    }
  },

  window: {
    close: (): void => ipcRenderer.send('window:close'),
    minimize: (): void => ipcRenderer.send('window:minimize')
  }
}

contextBridge.exposeInMainWorld('loader', api)

export type LoaderApi = typeof api
