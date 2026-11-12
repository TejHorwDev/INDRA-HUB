import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // Everything the app needs at runtime travels inside `out/` (see the
    // `files` list in electron-builder.yml), so the sanitizer is bundled
    // instead of left as a bare `require` that would not resolve in the
    // installed app. The same rule is what lets an in-app update payload be a
    // single self-contained archive.
    plugins: [externalizeDepsPlugin({ exclude: ['sanitize-html'] })],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
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
    // The renderer runs in a bundled Chromium, so ship modern, minified code:
    // smaller files mean a faster first paint on launch.
    build: {
      minify: true,
      target: 'esnext',
      sourcemap: false,
      chunkSizeWarningLimit: 900
    },
    server: {
      port: 5173,
      strictPort: true
    }
  }
})
