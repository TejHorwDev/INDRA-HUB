import type { LoaderApi } from './index'

declare global {
  interface Window {
    loader: LoaderApi
  }
}

export {}
