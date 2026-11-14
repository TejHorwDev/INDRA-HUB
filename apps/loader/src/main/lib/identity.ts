import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/*
 * Who this app is, said out loud.
 *
 * INDRA HUB and INDRA LOADER install side by side on the same machine. Every
 * value below is the difference between two independent applications and one
 * merged mess: a shared userData folder, a shared taskbar group, or a shared
 * single-instance lock would make one app's data, windows or update cache
 * collide with the other's.
 *
 * Defaults are not trusted. Electron derives the data folder from the packaged
 * package.json name, which is exactly the kind of value that changes when a
 * field is renamed — so it is set explicitly, and `sim:isolation` fails the
 * build if these ever equal the other app's.
 */

export const APP_NAME = 'INDRA LOADER'
export const APP_ID = 'com.indra.loader'

let applied = false

export function applyIdentity(): void {
  if (applied) return
  applied = true

  app.setName(APP_NAME)

  // %APPDATA%\INDRA LOADER — update payloads, preferences. Nothing sensitive.
  // Created before it is set: Electron refuses a userData path that does not
  // exist, and this runs before anything has had a chance to create it.
  const data = join(app.getPath('appData'), APP_NAME)
  mkdirSync(data, { recursive: true })
  app.setPath('userData', data)

  // Windows groups taskbar buttons by this id. Without it both apps claim the
  // same group and pinning one pins the other.
  app.setAppUserModelId(APP_ID)
}
