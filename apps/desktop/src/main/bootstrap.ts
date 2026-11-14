import { app } from 'electron'
import { join } from 'node:path'
import { discardActive, resolveActivePayload } from './lib/payload'

/*
 * Entry point, and the whole of the in-app update mechanism.
 *
 * The installed app starts here every time. If a verified payload is waiting in
 * the user's data folder it is loaded instead of the copy that came with the
 * installer; otherwise the shipped copy runs. The payload is a normal asar
 * archive, so its `main/index.js` executes exactly as it would inside
 * `resources/app.asar`, and every relative path in it resolves the same way.
 *
 * `require` is built with `join()` rather than written literally so the bundler
 * leaves both of these as runtime requires: the point is that they are two
 * different files, decided at runtime.
 */

const payload = resolveActivePayload()

if (payload) {
  try {
    require(join(payload.path, 'main', 'index.js'))
  } catch (error) {
    // A payload that cannot even load is a payload we should not keep trying.
    console.error('[bootstrap] payload failed to load, using the installed copy', error)
    discardActive()
    require(join(__dirname, 'index.js'))
  }
} else {
  require(join(__dirname, 'index.js'))
}
