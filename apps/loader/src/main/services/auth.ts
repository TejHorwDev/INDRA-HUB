import { app } from 'electron'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AuthResult, SessionInfo } from '@shared/types'
import { deviceId } from '../lib/device'

/*
 * The auth client.
 *
 * Talks to INDRA Auth's client API (`/v1/*`) from the main process only. Two
 * consequences, both deliberate:
 *
 *  - The token never enters the renderer and is never written down. It lives in
 *    the module below for the length of the session and is gone when the app is.
 *
 * There was a release in which it was remembered — encrypted with the OS secret
 * store, restored after an update restart — and it was wrong twice over: it removed
 * the sign-in screen from the app, and it decided who was signed in on somebody's
 * behalf. The app asks. Every time, on every launch, without exceptions.
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

/*
 * Nothing of a previous release's remembered session is left behind.
 *
 * That file held a real token, encrypted with the OS secret store. It is not used by
 * this build at all, so the only honest thing to do with it is delete it — a token on
 * disk is a token on disk whether or not the code that wrote it still exists.
 */
/**
 * The bearer token, for the one service that needs it.
 *
 * Module-private by intent: this is the only way anything outside this file can reach
 * the token, and it exists solely so the entitlement lookup can present it. It is never
 * passed to the renderer, never written down, never logged.
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

export function forgetStoredSession(): void {
  try {
    rmSync(join(app.getPath('userData'), 'session.bin'), { force: true })
  } catch {
    /* nothing to forget */
  }
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
  forgetStoredSession()
  if (!active) return

  try {
    await post('/v1/logout', {}, active.token)
  } catch (error) {
    console.warn('[auth] logout did not reach the server', error instanceof Error ? error.message : error)
  }
}
