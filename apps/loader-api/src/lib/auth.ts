import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { adminReady, env } from './env'

/*
 * One administrator, one session cookie.
 *
 * There is no user table and no password reset: the panel has exactly one person
 * who uses it, and adding accounts would be inventing a problem. What matters is
 * that the cookie is httpOnly, signed, expires, and that a wrong password costs
 * something.
 */

const COOKIE = 'indra_admin'
const ISSUER = 'indra-loader-api'
const AUDIENCE = 'indra-loader-admin'
const SESSION_HOURS = 12

/** A fixed salt is fine here: the password is compared, never stored. */
const SALT = 'indra-loader-admin-v1'

function digest(password: string): Buffer {
  return scryptSync(password, SALT, 64)
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env.sessionSecret)
}

export function checkCredentials(username: string, password: string): boolean {
  if (!adminReady()) return false

  const userOk = timingSafeEqual(
    createHash('sha256').update(username.toLowerCase()).digest(),
    createHash('sha256').update(env.adminUsername.toLowerCase()).digest()
  )
  const passOk = timingSafeEqual(digest(password), digest(env.adminPassword))

  // Both compared, always, so a wrong username and a wrong password take the
  // same time to reject.
  return userOk && passOk
}

export async function issueSession(): Promise<string> {
  return new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret())
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token || env.sessionSecret.length < 32) return false
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, audience: AUDIENCE })
    return payload.role === 'admin'
  } catch {
    return false
  }
}

export async function currentSession(): Promise<boolean> {
  const store = await cookies()
  return verifySession(store.get(COOKIE)?.value)
}

export const SESSION_COOKIE = COOKIE

export function cookieOptions(): {
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  path: string
  maxAge: number
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_HOURS * 60 * 60
  }
}

/* ------------------------------------------------------------ throttling ---- */

/*
 * Ten attempts per quarter hour, per address. Not a security boundary — a proxy
 * or a botnet defeats it — but it turns an offline guessing attack into something
 * that takes a month instead of a minute.
 */
const WINDOW_MS = 15 * 60 * 1000
const LIMIT = 10
const attempts = new Map<string, { count: number; resetAt: number }>()

export function tooManyAttempts(address: string): boolean {
  const now = Date.now()
  const record = attempts.get(address)

  if (!record || now > record.resetAt) {
    attempts.set(address, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }

  record.count += 1
  return record.count > LIMIT
}

export function noteSuccess(address: string): void {
  attempts.delete(address)
}

/** A random secret for whoever is setting this up. Printed only by `npm run key`. */
export function generateSecret(): string {
  return randomBytes(32).toString('base64url')
}
