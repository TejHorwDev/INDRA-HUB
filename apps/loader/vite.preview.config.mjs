import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/*
 * The renderer, in a plain browser.
 *
 * Same components, same CSS, same 900x550 frame — with a mock bridge, because
 * there is no Electron here (`src/renderer/src/lib/bridge.ts`). It exists so the
 * interface and the motion can be looked at without building or installing
 * anything, and so a design change can be judged in seconds.
 *
 * Not part of the shipped app: `npm run build` never reads this file.
 */
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  server: {
    // Reachable from the preview host, not just this machine.
    host: '0.0.0.0',
    port: 5274,
    strictPort: true,
    allowedHosts: true
  }
})
