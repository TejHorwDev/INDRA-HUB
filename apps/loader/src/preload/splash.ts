import { contextBridge, ipcRenderer } from 'electron'

/*
 * The card's only surface.
 *
 * Two directions: the main process says which stage to show, and the page says it
 * has painted. Nothing else crosses, because nothing else needs to.
 */
contextBridge.exposeInMainWorld('launch', {
  onStage: (listener: (stage: string) => void): void => {
    ipcRenderer.on('launch:stage', (_event, stage: string) => listener(stage))
  },
  /** The backdrop film, when the panel has published one. */
  onVideo: (listener: (url: string) => void): void => {
    ipcRenderer.on('launch:video', (_event, url: string) => listener(url))
  },
  ready: (): void => {
    ipcRenderer.send('launch:ready')
  }
})
