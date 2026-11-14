import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AuthResult, SessionInfo } from '@shared/types'
import { deviceId } from '../lib/device'

/*
 * The auth client.
 *
 * Talks to INDRA Auth's client API (`/v1/*`) from the main process only. Two
 * consequences, both deliberate:
 *
 *  - The token never enters the renderer. It lives in the module below and is
 *    written to disk only through the operating system's secret store — DPAPI on
 *    Windows, via Electron's `safeStorage` — so what is on disk is ciphertext that
 *    only this user on this machine can open. Nothing ever logs it.
 *
 * The session is remembered because of what a forgotten one costs: this app
 * restarts itself to apply updates, and a restart that lands on a password box is
 * indistinguishable from a crash. Remembered, an update is a two-second blink.
 *  - Requests are not browser requests, so there is no CORS preflight and no
 *    origin allowlist to negotiate with the auth service.
 *
 * The failure strings are the contract, not decoration: "Connection failed"
 * when no response arrived, "HTTP <status>" when one did and said no, and the
 * server's own `detail` when it bothered to send one.
 */

const AUTH_BASE = (process.env['INDRA_LOADER_AUTH_BASE'] ?? 'https://indra-auth.onrender.com').replace(
  /\/+$/,
  ''
)

/** INDRA LOADER's own product id in INDRA Auth. */
const APP_ID = process.env['INDRA_LOADER_APP_ID'] ?? 'f2bfc9baa7c99b90c0d6974b'

const LOGIN_TIMEOUT_MS = 20_000

interface LoginResponse {
  token?: unknown
  username?: unknown
  expires?: unknown
  detail?: unknown
}

interface Session {
  token: string
  username: string
  expires: string | null
}

let session: Session | null = null

/** The remembered session, in the OS secret store. Ciphertext, never the token. */
const SESSION_FILE = 'session.bin'
const sessionFile = (): string => join(app.getPath('userData'), SESSION_FILE)

/**
 * Writes the session down, encrypted.
 *
 * `safeStorage` is not available on every Linux desktop (no keyring, no libsecret),
 * and a session that cannot be encrypted is not written at all — a plaintext token
 * on disk is worse than signing in again.
 */
function remember(next: Session): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) return
    writeFileSync(sessionFile(), safeStorage.encryptString(JSON.stringify(next)))
  } catch (error) {
    console.warn('[auth] could not remember the session', error instanceof Error ? error.message : error)
  }
}

function forget(): void {
  try {
    rmSync(sessionFile(), { force: true })
  } catch {
    /* nothing to forget */
  }
}

function recalled(): Session | null {
  try {
    if (!existsSync(sessionFile()) || !safeStorage.isEncryptionAvailable()) return null
    const raw = safeStorage.decryptString(readFileSync(sessionFile()))
    const parsed = JSON.parse(raw) as Partial<Session>
    if (typeof parsed.token !== 'string' || !parsed.token) return null
    return {
      token: parsed.token,
      username: typeof parsed.username === 'string' ? parsed.username : '',
      expires: typeof parsed.expires === 'string' ? parsed.expires : null
    }
  } catch {
    return null
  }
}

/** Past its own expiry, by the clock rather than by a guess. Never tried. */
function expired(next: Session): boolean {
  if (!next.expires) return false
  const at = Date.parse(next.expires)
  return Number.isFinite(at) && at < Date.now()
}

/**
 * Does the token still work?
 *
 * `GET /v1/apps` is the one endpoint this app already calls with the token, so it is
 * also the cheapest way to ask. An explicit refusal drops the session and shows the
 * form; no answer at all keeps it, because being offline is not the same as being
 * signed out and demanding a password for a flat network would be a bug of its own.
 */
async function stillValid(token: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(`${AUTH_BASE}/v1/apps`, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'x-session-token': token
      },
      cache: 'no-store'
    })
    if (response.status === 401 || response.status === 403) return false
    return true
  } catch {
    return true
  } finally {
    clearTimeout(timer)
  }
}

/** Reused instead of relogging: null until asked for, once. */
let restoring: Promise<SessionInfo | null> | null = null

/**
 * The session from the last run, if it is still good.
 *
 * Called once as the window comes up. Everything about it is a refusal to make
 * somebody type a password they already typed: the file is only accepted when the
 * OS can decrypt it, the expiry is checked before any request, and the token is
 * checked before any screen is skipped.
 */
export function restoreSession(): Promise<SessionInfo | null> {
  if (session) return Promise.resolve(currentSession())
  restoring ??= (async () => {
    const saved = recalled()
    if (!saved) return null
    if (expired(saved) || !(await stillValid(saved.token))) {
      forget()
      return null
    }
    session = saved
    return currentSession()
  })().finally(() => {
    restoring = null
  })
  return restoring
}

/**
 * The bearer token, for the one service that needs it.
 *
 * Module-private by intent: this is the only way anything outside this file can
 * reach the token, and it exists solely so the entitlement lookup can present it.
 * It is never passed to the renderer, never written down, never logged.
 */
export function sessionToken(): string | null {
  return session?.token ?? null
}

export function authBase(): string {
  return AUTH_BASE
}

export function currentSession(): SessionInfo | null {
  return session ? { username: session.username, expires: session.expires } : null
}

/**
 * A sentence out of whatever the server sent.
 *
 * FastAPI answers a validation failure with `detail` as an array of objects and
 * everything else with `detail` as a string, so both shapes are read rather than
 * only the convenient one.
 */
function messageFrom(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>

  if (typeof record['detail'] === 'string' && record['detail'].trim()) {
    return record['detail'].trim()
  }

  if (Array.isArray(record['detail'])) {
    const first = record['detail'][0]
    if (first && typeof first === 'object') {
      const entry = first as Record<string, unknown>
      const field = Array.isArray(entry['loc']) ? entry['loc'].slice(-1)[0] : null
      const text = typeof entry['msg'] === 'string' ? entry['msg'] : null
      if (text) return field ? `${String(field)}: ${text}` : text
    }
  }

  if (typeof record['message'] === 'string' && record['message'].trim()) {
    return record['message'].trim()
  }

  return null
}

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS)
  try {
    return await fetch(`${AUTH_BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function login(username: string, password: string): Promise<AuthResult> {
  const user = username.trim()

  // Checked here so the sentence is useful, and so an empty password is never
  // sent anywhere.
  if (!user || !password) {
    return { ok: false, error: 'Enter username & password' }
  }

  const device = deviceId(APP_ID)
  if (!device) {
    return { ok: false, error: 'Could not create a device ID' }
  }

  let response: Response
  try {
    response = await post('/v1/login', {
      username: user,
      password,
      app_id: APP_ID,
      device_id: device,
      device_name: 'Desktop'
    })
  } catch (error) {
    // No status at all: DNS, TLS, an offline machine, a sleeping host.
    console.error('[auth] login did not reach the server', error instanceof Error ? error.message : error)
    return { ok: false, error: 'Connection failed' }
  }

  let body: LoginResponse | null = null
  try {
    body = (await response.json()) as LoginResponse
  } catch {
    body = null
  }

  if (!response.ok) {
    return { ok: false, error: messageFrom(body) ?? `HTTP ${response.status}` }
  }

  if (!body || typeof body.token !== 'string' || !body.token) {
    return { ok: false, error: 'Server did not return a session token' }
  }

  session = {
    token: body.token,
    username: typeof body.username === 'string' && body.username ? body.username : user,
    expires: typeof body.expires === 'string' ? body.expires : null
  }
  remember(session)

  return { ok: true, username: session.username, expires: session.expires }
}

/**
 * Ends the session server-side.
 *
 * Best effort by design: whatever the server says, the token is gone locally. A
 * failed logout must never trap a user in a signed-in app.
 */
export async function logout(): Promise<void> {
  const active = session
  session = null
  forget()
  if (!active) return

  try {
    await post('/v1/logout', {}, active.token)
  } catch (error) {
    console.warn('[auth] logout did not reach the server', error instanceof Error ? error.message : error)
  }
}
