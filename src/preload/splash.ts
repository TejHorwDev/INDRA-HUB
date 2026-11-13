import { contextBridge, ipcRenderer } from 'electron'

/*
 * The launch window's only bridge.
 *
 * It can do exactly two things: say it has painted, and receive which stage the
 * main process is in. No database, no session, no filesystem — the smallest
 * possible surface for the smallest possible window.
 */
contextBridge.exposeInMainWorld('launch', {
  onStage: (listener: (stage: string) => void): void => {
    ipcRenderer.on('launch:stage', (_event, stage: string) => listener(stage))
  },
  ready: (): void => {
    ipcRenderer.send('launch:ready')
  }
})
