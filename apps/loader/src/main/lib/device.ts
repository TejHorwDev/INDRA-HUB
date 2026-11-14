import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * The device identity INDRA Auth sees.
 *
 * 32 random bytes as 64 lowercase hex characters, kept per application under
 * %LOCALAPPDATA%\INDRAAuth\<app_id>\ and reused forever.
 *
 * Two details matter more than they look:
 *
 *  - It is stored per app_id, so INDRA HUB and INDRA LOADER are different
 *    devices to the auth server, and each gets its own device limit.
 *  - It survives an uninstall. A fresh id after a reinstall would look like a
 *    new device and burn a slot the user had already used.
 */

const VALID = /^[a-f0-9]{64}$/

function root(): string {
  /*
   * %LOCALAPPDATA%\INDRAAuth, as the design specifies. Electron's path list has
   * no `localAppData` entry, so the environment variable is read directly —
   * which is also what makes this the same folder whether it is resolved by this
   * app, by INDRA HUB or by anything else on the machine.
   */
  const local = process.platform === 'win32' ? process.env['LOCALAPPDATA'] : undefined
  const base = local && local.trim() ? local : app.getPath('appData')
  return join(base, 'INDRAAuth')
}

function file(appId: string): string {
  const safe = appId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)
  return join(root(), safe, 'device-id')
}

/** Reads the stored id if it is still valid. Never rewrites a good one. */
function read(appId: string): string | null {
  try {
    const value = readFileSync(file(appId), 'utf8').trim().toLowerCase()
    return VALID.test(value) ? value : null
  } catch {
    return null
  }
}

/**
 * The device id, created on first use.
 *
 * Returns null when it cannot be created or read — the caller turns that into
 * "Could not create a device ID" rather than sending an empty string and
 * letting the server answer with something less useful.
 */
export function deviceId(appId: string): string | null {
  const existing = read(appId)
  if (existing) return existing

  try {
    const generated = randomBytes(32).toString('hex')
    const path = file(appId)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, generated, { encoding: 'utf8', mode: 0o600 })
    return existsSync(path) ? generated : null
  } catch (error) {
    console.error('[device] could not create a device id', error)
    return null
  }
}
