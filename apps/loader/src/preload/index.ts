import { contextBridge, ipcRenderer } from 'electron'
import type { AuthResult, LoaderBridge, SessionInfo, UpdateDiagnostics, UpdateState } from '@shared/types'

/*
 * The only surface the renderer has.
 *
 * No token, no file path, no URL and no Electron object crosses this bridge —
 * the renderer can ask for state and request actions, and nothing else. The type
 * it implements lives in `@shared/types`, so this file and the mock used for
 * browser previews cannot drift apart silently.
 */
const bridge: LoaderBridge = {
  version: () => ipcRenderer.invoke('app:version'),

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

  auth: {
    login: (username: string, password: string): Promise<AuthResult> =>
      ipcRenderer.invoke('auth:login', username, password),
    logout: (): Promise<void> => ipcRenderer.invoke('auth:logout'),
    session: (): Promise<SessionInfo | null> => ipcRenderer.invoke('auth:session')
  },

  links: {
    open: async (url: string): Promise<void> => ipcRenderer.invoke('links:open', url)
  },

  window: {
    close: (): void => ipcRenderer.send('window:close'),
    minimize: (): void => ipcRenderer.send('window:minimize')
  }
}

contextBridge.exposeInMainWorld('loader', bridge)
