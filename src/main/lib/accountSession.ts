import type { AccountState } from '@shared/types'
import { getDatabase } from '../db/database'
import { errors } from './errors'
import { sealSecret, unsealSecret } from './seal'
import { SupabaseError, supabaseRequest } from './supabase'
import { recheckConnectivity } from '../services/connectivity'

/*
 * The human session, at rest.
 *
 * What is stored here is a Supabase refresh token and the access token that
 * goes with it — never a password. The blob is sealed with the OS keystore, and
 * when the keystore is unavailable the seal says so rather than pretending
 * (`sealSecret` writes `plain:v1:`), which is what `AccountState.sealed` reports
 * to the person.
 *
 * The session belongs to the installation, not to the machine's cloud identity:
 * one human signs in, one profile exists, and every server call is made as that
 * profile. The per-device `device-*@device.indra.hub` identity survives only for
 * accounts that have not been migrated yet — see `cloud.ts`.
 */

const SESSION_KEY = 'indra_account_session'
/** Refresh a minute early: a token that expires mid-request is a failed save. */
const REFRESH_MARGIN_MS = 60_000

export type AccountRole = 'member' | 'admin'

export interface AccountSession {
  /** The Supabase auth user id (`auth.users.id`). */
  uid: string
  email: string
  accessToken: string
  refreshToken: string
  /** Epoch milliseconds. */
  expiresAt: number
  /** The `indra_users` row every table and policy keys on. */
  profileId: string
  memberNo: string
  role: AccountRole
  displayName: string
  username: string
}

export interface StoredAccount {
  session: AccountSession | null
  /** A row exists, even if it could not be unsealed on this machine. */
  present: boolean
  sealed: boolean
}

interface StoredShape {
  uid?: unknown
  email?: unknown
  accessToken?: unknown
  refreshToken?: unknown
  expiresAt?: unknown
  profileId?: unknown
  memberNo?: unknown
  role?: unknown
  displayName?: unknown
  username?: unknown
}

export interface AuthTokenPayload {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  expires_at?: number
  user?: { id?: string; email?: string }
}

function readRaw(): string | null {
  const row = getDatabase()
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(SESSION_KEY) as { value: string } | undefined
  return row?.value ?? null
}

function writeRaw(value: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(SESSION_KEY, value, new Date().toISOString())
}

/** Reads the session without touching the network. */
export function readStoredAccount(): StoredAccount {
  const stored = readRaw()
  if (!stored) return { session: null, present: false, sealed: false }

  const opened = unsealSecret(stored)
  if (!opened.value) return { session: null, present: true, sealed: opened.sealed }

  let parsed: StoredShape
  try {
    parsed = JSON.parse(opened.value) as StoredShape
  } catch {
    return { session: null, present: true, sealed: opened.sealed }
  }

  if (
    typeof parsed.uid !== 'string' ||
    typeof parsed.email !== 'string' ||
    typeof parsed.refreshToken !== 'string' ||
    typeof parsed.profileId !== 'string'
  ) {
    return { session: null, present: true, sealed: opened.sealed }
  }

  return {
    present: true,
    sealed: opened.sealed,
    session: {
      uid: parsed.uid,
      email: parsed.email,
      accessToken: typeof parsed.accessToken === 'string' ? parsed.accessToken : '',
      refreshToken: parsed.refreshToken,
      expiresAt: Number(parsed.expiresAt) || 0,
      profileId: parsed.profileId,
      memberNo: typeof parsed.memberNo === 'string' ? parsed.memberNo : '',
      role: parsed.role === 'admin' ? 'admin' : 'member',
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : '',
      username: typeof parsed.username === 'string' ? parsed.username : ''
    }
  }
}

export function readAccount(): AccountSession | null {
  return readStoredAccount().session
}

export function saveAccount(session: Omit<AccountSession, never>): void {
  writeRaw(sealSecret(JSON.stringify(session)))
}

/** Keeps the cached profile fields in step with the server's row. */
export function patchAccount(patch: Partial<Pick<AccountSession, 'profileId' | 'memberNo' | 'role' | 'displayName' | 'username' | 'email'>>): AccountSession | null {
  const session = readAccount()
  if (!session) return null
  const next: AccountSession = { ...session, ...patch }
  saveAccount(next)
  return next
}

export function clearAccount(): void {
  getDatabase().prepare('DELETE FROM app_settings WHERE key = ?').run(SESSION_KEY)
}

/** The account this local user mirrors, when there is one. */
export function sessionForLocalUser(localUserId: string): AccountSession | null {
  const row = getDatabase()
    .prepare('SELECT auth_user_id FROM users WHERE id = ?')
    .get(localUserId) as { auth_user_id: string | null } | undefined
  if (!row?.auth_user_id) return null

  const session = readAccount()
  if (!session || session.uid !== row.auth_user_id) return null
  return session
}

/**
 * Turns an auth response into a session, keeping the profile the caller already
 * knows (the token endpoints do not return it).
 */
export function sessionFromToken(
  payload: AuthTokenPayload,
  base: Pick<AccountSession, 'email' | 'profileId' | 'memberNo' | 'role' | 'displayName' | 'username'>,
  previous?: AccountSession | null
): AccountSession {
  if (!payload.access_token || !payload.user?.id) {
    throw errors.cloud('The server would not start a session for this account.')
  }
  const expiresAt =
    typeof payload.expires_at === 'number'
      ? payload.expires_at * 1000
      : Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000

  return {
    uid: payload.user.id,
    email: payload.user.email ?? base.email,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? previous?.refreshToken ?? '',
    expiresAt,
    profileId: base.profileId,
    memberNo: base.memberNo,
    role: base.role,
    displayName: base.displayName,
    username: base.username
  }
}

/**
 * Exchanges the refresh token for a fresh access token.
 *
 * A refused refresh is not a temporary problem: the token was revoked, the
 * account was deleted, or the password changed elsewhere. The stored session is
 * cleared so the app cannot keep presenting a dead identity as a live one.
 */
export async function refreshAccount(): Promise<AccountSession> {
  const session = readAccount()
  if (!session) throw errors.authRequired()

  let payload: AuthTokenPayload
  try {
    payload = await supabaseRequest<AuthTokenPayload>('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: session.refreshToken }
    })
  } catch (error) {
    if (error instanceof SupabaseError && (error.status === 400 || error.status === 401)) {
      clearAccount()
      throw errors.authRequired()
    }
    throw error
  }

  const renewed = sessionFromToken(payload, session, session)
  saveAccount(renewed)
  return renewed
}

/**
 * A session whose access token is good for at least another minute.
 *
 * Offline, a still-valid token is returned as-is: the server is unreachable,
 * not the person unauthorised. Once it has expired there is nothing to send, and
 * that is reported as an offline failure rather than a sign-out, so an edit made
 * with no connection stays queued instead of being thrown away.
 */
export async function liveAccount(): Promise<AccountSession> {
  const session = readAccount()
  if (!session) throw errors.authRequired()
  if (session.expiresAt - REFRESH_MARGIN_MS > Date.now()) return session

  if (!recheckConnectivity().online) {
    if (session.expiresAt > Date.now()) return session
    throw errors.cloud(
      'This PC is offline and the INDRA session has expired. Reconnect to sign in again — nothing has been lost.'
    )
  }

  return refreshAccount()
}

/** A cheap, offline-safe description of the session for the renderer. */
export function accountStateFor(session: AccountSession | null, stored: StoredAccount): AccountState {
  return {
    connected: Boolean(session),
    stale: Boolean(session) && (session?.expiresAt ?? 0) <= Date.now(),
    email: session?.email ?? null,
    displayName: session?.displayName ?? null,
    username: session?.username ?? null,
    profileId: session?.profileId ?? null,
    memberNo: session?.memberNo ?? null,
    role: session?.role ?? null,
    sealed: stored.sealed,
    online: recheckConnectivity().online,
    expiresAt: session ? new Date(session.expiresAt).toISOString() : null
  }
}

export function accountState(): AccountState {
  const stored = readStoredAccount()
  return accountStateFor(stored.session, stored)
}
