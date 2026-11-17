/*
 * Who is looking at the ledger.
 *
 * Two roles, one login form:
 *   owner  — me. Creates clients, records payments, keeps the books.
 *   client — the person I built something for. Sees their own projects and payments, and
 *            downloads their own receipts. Sees nothing else, by construction: every client
 *            query is filtered by their own client id, taken from the session, never from
 *            the URL.
 *
 * Passwords are scrypt, salted per user, compared in constant time. Sessions are a random
 * token in an http-only cookie; the database only keeps its SHA-256, so a copy of the table
 * cannot be replayed. Expiry is checked on every request, which is also what makes
 * "sign out everywhere" work by deleting rows.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { db, eq } from './db'

export const COOKIE = 'svc_session'
const DAY = 86_400
const SESSION_DAYS = 30

export type Role = 'owner' | 'client'

export interface User {
  id: string
  client_id: string | null
  username: string
  role: Role
  status: string
}

export interface ClientRow {
  id: string
  client_no: string
  name: string
  company: string | null
  phone: string | null
  email: string | null
  country: string | null
  status: string
  notes: string | null
  created_at: string
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const key = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${key}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':')
  if (!salt || !key) return false
  const expected = Buffer.from(key, 'hex')
  const actual = scryptSync(password, salt, expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Creates a session row and returns the raw token.
 *
 * The cookie is set by the caller — a route handler, where the response headers are ours to
 * write. Setting it from inside a server action and then redirecting worked in every local
 * test and then, in production, arrived as a login that bounced straight back to the login
 * form. A route handler has no such gap: the Set-Cookie header is on the same 303 the browser
 * follows.
 */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + SESSION_DAYS * DAY * 1000).toISOString()
  await db.insert('svc_sessions', { user_id: userId, token_hash: digest(token), expires_at: expires })
  return token
}

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_DAYS * DAY
}

export async function deleteSession(token: string): Promise<void> {
  await db.remove('svc_sessions', `token_hash=eq.${digest(token)}`)
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (!token) return null

  const sessions = await db.select<{ user_id: string; expires_at: string }>(
    'svc_sessions',
    `select=user_id,expires_at&token_hash=eq.${digest(token)}`
  )
  const session = sessions[0]
  if (!session) return null

  if (new Date(session.expires_at).getTime() < Date.now()) {
    await db.remove('svc_sessions', `token_hash=eq.${digest(token)}`)
    return null
  }

  const users = await db.select<
    Pick<User, 'id' | 'client_id' | 'username' | 'role' | 'status'>
  >('svc_users', `select=id,client_id,username,role,status&id=eq.${session.user_id}`)

  const user = users[0]
  if (!user || user.status !== 'active') return null
  return user as User
}

export async function requireUser(): Promise<User> {
  const user = await currentUser()
  if (!user) throw new Error('NOT_SIGNED_IN')
  return user
}

export async function requireOwner(): Promise<User> {
  const user = await requireUser()
  if (user.role !== 'owner') throw new Error('NOT_ALLOWED')
  return user
}

/** True when nobody has signed up yet — the first screen then asks for the owner's details. */
export async function needsOwner(): Promise<boolean> {
  const rows = await db.select<{ id: string }>('svc_users', "select=id&role=eq.owner&limit=1")
  return rows.length === 0
}

export async function clientFor(user: User): Promise<ClientRow | null> {
  if (!user.client_id) return null
  const rows = await db.select<ClientRow>('svc_clients', `select=*&id=eq.${eq(user.client_id)}`)
  return rows[0] ?? null
}
