import type { LoaderBridge } from '@shared/types'

declare global {
  interface Window {
    /** Present in Electron. Absent in a browser preview, where a mock is used. */
    loader?: LoaderBridge
  }
}

export {}
