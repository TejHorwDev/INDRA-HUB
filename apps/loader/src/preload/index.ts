import { contextBridge, ipcRenderer } from 'electron'
import type {
  AuthResult,
  Catalogue,
  EntitlementReport,
  InstallView,
  LaunchResult,
  LoaderBridge,
  SessionInfo,
  UpdateDiagnostics,
  UpdateState
} from '@shared/types'

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
    log: (): Promise<string[]> => ipcRenderer.invoke('update:log'),
    updateLaunch: (): Promise<boolean> => ipcRenderer.invoke('update:launch'),
    screen: (screen: string): void => ipcRenderer.send('update:screen', screen),
    activity: (activity: { screen: string; typing: boolean }): void =>
      ipcRenderer.send('update:activity', activity),
    onState: (listener: (state: UpdateState) => void): (() => void) => {
      const handler = (_event: unknown, state: UpdateState): void => listener(state)
      ipcRenderer.on('update:state', handler)
      return () => ipcRenderer.removeListener('update:state', handler)
    }
  },

  catalogue: {
    load: (): Promise<Catalogue> => ipcRenderer.invoke('catalogue:load')
  },

  auth: {
    probe: (): Promise<EntitlementReport> => ipcRenderer.invoke('auth:probe'),
    login: (username: string, password: string): Promise<AuthResult> =>
      ipcRenderer.invoke('auth:login', username, password),
    owned: (): Promise<string[]> => ipcRenderer.invoke('auth:owned'),
    logout: (): Promise<void> => ipcRenderer.invoke('auth:logout'),
    session: (): Promise<SessionInfo | null> => ipcRenderer.invoke('auth:session'),
    restore: (): Promise<SessionInfo | null> => ipcRenderer.invoke('auth:restore')
  },

  files: {
    states: (): Promise<Record<string, InstallView>> => ipcRenderer.invoke('files:states'),
    download: (id: string): Promise<InstallView> => ipcRenderer.invoke('files:download', id),
    cancel: (id: string): Promise<InstallView> => ipcRenderer.invoke('files:cancel', id),
    uninstall: (id: string): Promise<InstallView> => ipcRenderer.invoke('files:uninstall', id),
    launch: (id: string): Promise<LaunchResult> => ipcRenderer.invoke('files:launch', id),
    reveal: (id: string): Promise<void> => ipcRenderer.invoke('files:reveal', id),
    onState: (
      listener: (states: Record<string, InstallView>) => void
    ): (() => void) => {
      const handler = (_event: unknown, states: Record<string, InstallView>): void => listener(states)
      ipcRenderer.on('files:state', handler)
      return () => ipcRenderer.removeListener('files:state', handler)
    }
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
