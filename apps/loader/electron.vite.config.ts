import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    /*
     * The catalogue's address is baked in at build time: an installed app has no
     * environment to read. Set INDRA_LOADER_API on the release job and every
     * installer after that points at it.
     */
    define: {
      __LOADER_API__: JSON.stringify(process.env.INDRA_LOADER_API ?? '')
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // The launch card has its own preload: two windows, two surfaces.
        input: {
          index: resolve('src/preload/index.ts'),
          splash: resolve('src/preload/splash.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      minify: true,
      target: 'esnext',
      sourcemap: false,
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          // The launch card is its own page, built and copied beside the app.
          splash: resolve('src/renderer/splash.html')
        }
      }
    },
    server: {
      port: 5273,
      strictPort: true
    }
  }
})
