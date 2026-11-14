import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/*
 * The startup shim is built on its own, as a single self-contained file.
 *
 * It has to be a second file next to `out/main/index.js`, and it has to be the
 * thing package.json points at. Building it in the same pass as the app makes the
 * bundler hoist the app into a shared chunk that the shim then requires for side
 * effects — which runs the app before any choice about which copy of the code to
 * load has been made. One entry, one pass, no shared chunks.
 */
export default defineConfig({
  resolve: {
    alias: { '@shared': resolve('src/shared') }
  },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: 'src/main/bootstrap.ts',
    outDir: 'out/main',
    emptyOutDir: false,
    minify: false,
    target: 'node22',
    rollupOptions: {
      external: ['electron'],
      output: {
        entryFileNames: 'bootstrap.js',
        format: 'cjs',
        codeSplitting: false
      }
    }
  }
})
