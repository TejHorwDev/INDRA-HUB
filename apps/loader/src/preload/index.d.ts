import type { LoaderBridge } from '@shared/types'

declare global {
  interface Window {
    loader?: LoaderBridge
  }
}

export {}
