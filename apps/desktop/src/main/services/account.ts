import { randomBytes, randomUUID } from 'node:crypto'
import type {
  AccountCreateInput,
  AccountCredentialsInput,
  AccountSignInResult,
  AccountState,
  RegisterInput,
  SessionUser
} from '@shared/types'
import { getDatabase } from '../db/database'
import {
  accountStateFor,
  clearAccount,
  readStoredAccount,
  saveAccount,
  sessionFromToken,
  type AccountRole,
  type AccountSession,
  type AuthTokenPayload
} from '../lib/accountSession'
import { AppError, errors } from '../lib/errors'
import { hashPassword, verifyPassword } from '../lib/password'
import { EMAIL_PATTERN, normalizeEmail } from '../lib/validation'
import { SupabaseError, asRow, supabaseRpc, supabaseRequest } from '../lib/supabase'
import { activeSessionUserId, clearLocalPassword, discardLocalAccount, openSessionFor, register, signOut } from './auth'
import { recheckConnectivity } from './connectivity'
import { syncAfterSignIn } from './sync'
import { checkServerActivationKey, redeemServerActivationKey } from './activation'
import { liveAccount } from '../lib/accountSession'
import { readSettings } from './settings'
import { findUserById } from './users'

/*
 * The human account.
 *
 * Before this module the app had one identity per installation: a generated
 * `device-…@device.indra.hub` user, sealed to the machine, created the first
 * time anyone pressed "save to cloud". That is why a second PC was a second
 * person. This module replaces it with a real Supabase Auth account that a
 * human signs in to, and mirrors it into the local `users` table so the rest of
 * the app — projects, documents, the session guard — keeps working unchanged
 * while the server becomes the authority.
 *
 * What it deliberately does not do: store a password. The sign-in password is
 * used once, sent to Supabase, and forgotten. What is stored is the refresh
 * token, sealed (`lib/accountSession.ts`).
 */

const USERNAME_FALLBACK = 'member'

interface ServerProfile {
  id: string
  username: string
  display_name: string
  member_no: string
  role: AccountRole
  suspended_at: string | null
}

interface ProfileRow {
  id?: unknown
  username?: unknown
  display_name?: unknown
  member_no?: unknown
  role?: unknown
  suspended_at?: unknown
}

function toProfile(value: ProfileRow | null): ServerProfile | null {
  if (!value || typeof value.id !== 'string') return null
  return {
    id: value.id,
    username: typeof value.username === 'string' ? value.username : '',
    display_name: typeof value.display_name === 'string' ? value.display_name : '',
    member_no: typeof value.member_no === 'string' ? value.member_no : '',
    role: value.role === 'admin' ? 'admin' : 'member',
    suspended_at: typeof value.suspended_at === 'string' ? value.suspended_at : null
  }
}

function requireConnection(): void {
  if (!recheckConnectivity().online) {
    throw errors.cloud(
      'Signing in to your INDRA account needs a connection. Your work on this PC is safe and can be opened offline.'
    )
  }
}

function cleanEmail(raw: string): string {
  const email = normalizeEmail(raw ?? '')
  if (!EMAIL_PATTERN.test(email)) {
    throw errors.validation('Enter a valid email address.', 'email')
  }
  return email
}

function mapAuthFailure(error: unknown, mode: 'signIn' | 'signUp'): never {
  if (error instanceof SupabaseError) {
    if (error.status === 400 || error.status === 401) {
      throw new AppError('INVALID_CREDENTIALS', 'That email or password is incorrect.')
    }
    if (error.status === 422) {
      throw errors.conflict('An INDRA account with that email already exists.', 'email')
    }
    if (error.status === 429) {
      throw errors.throttled('Too many attempts. Wait a minute and try again.')
    }
    if (error.status === 0) {
      throw errors.cloud('The server did not answer. Check the connection and try again.')
    }
    throw errors.cloud(
      mode === 'signUp'
        ? 'The account could not be created. Try again in a moment.'
        : 'The account could not be reached. Try again in a moment.'
    )
  }
  throw error
}

/**
 * The profile row `auth.sql`'s trigger created for this auth user.
 *
 * `indra_ensure_profile()` is called rather than read because the trigger
 * swallows its own failures by design (a broken profile must never block
 * sign-up), so the first read after sign-in is allowed to repair the row.
 */
async function ensureProfile(session: AccountSession): Promise<ServerProfile> {
  const fromRpc = await supabaseRpcProfile(session)
  if (fromRpc) return fromRpc

  const rows = await supabaseRequestList(session)
  const profile = toProfile(rows)
  if (!profile) {
    throw errors.cloud('Your account has no INDRA profile yet. Try again in a moment.')
  }
  return profile
}

async function supabaseRpcProfile(session: AccountSession): Promise<ServerProfile | null> {
  try {
    const value = await supabaseRpc<ProfileRow | ProfileRow[]>('indra_ensure_profile', {}, session.accessToken)
    return toProfile(asRow(value))
  } catch {
    // The function may not be deployed yet on an older project; the table read
    // below is the fallback, and a real failure surfaces there.
    return null
  }
}

async function supabaseRequestList(session: AccountSession): Promise<ProfileRow | null> {
  try {
    const rows = await supabaseRequest<ProfileRow[]>(
      `/rest/v1/indra_users?select=id,username,display_name,member_no,role,suspended_at&auth_user_id=eq.${encodeURIComponent(session.uid)}&limit=1`,
      { token: session.accessToken }
    )
    return Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null)
  } catch (error) {
    if (error instanceof SupabaseError) {
      throw errors.cloud('Your INDRA profile could not be read. Try again in a moment.')
    }
    throw error
  }
}

/** Keeps `contact_email` — the address invitations are addressed to — current. */
async function touchContactEmail(session: AccountSession): Promise<void> {
  try {
    await supabaseRequest(`/rest/v1/indra_users?id=eq.${encodeURIComponent(session.profileId)}`, {
      method: 'PATCH',
      token: session.accessToken,
      prefer: 'return=minimal',
      body: { contact_email: session.email, display_name: session.displayName || session.username }
    })
  } catch {
    // Best effort: the profile is usable without it, and the next sign-in
    // writes it again.
  }
}

/**
 * The local row that mirrors a server profile.
 *
 * Three cases, in order:
 *   1. a row already bound to this auth user — update it;
 *   2. a local account with the same email — adopt it, which is the migration
 *      path for everyone who has been using the app before INDRA accounts
 *      existed, and keeps their projects where they are;
 *   3. nothing — create the mirror, with a password nobody knows.
 *
 * The mirror never receives the account's real password. Its `password_hash` is
 * a hash of a random secret that is discarded, so the local password path
 * cannot be used to sign in as a server account.
 */
function mirrorLocalUser(profile: ServerProfile, email: string, uid: string): string {
  const db = getDatabase()
  const now = new Date().toISOString()
  const displayName = profile.display_name.trim() || profile.username || email

  const bound = db
    .prepare('SELECT id FROM users WHERE auth_user_id = ?')
    .get(uid) as { id: string } | undefined

  if (bound) {
    db.prepare(
      `UPDATE users
          SET display_name = ?, email = ?, cloud_profile_id = ?, cloud_role = ?, member_no = ?,
              last_sign_in_at = ?
       WHERE id = ?`
    ).run(displayName, email, profile.id, profile.role, profile.member_no, now, bound.id)
    return bound.id
  }

  const byEmail = db
    .prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE LIMIT 1')
    .get(email) as { id: string } | undefined

  if (byEmail) {
    db.prepare(
      `UPDATE users
          SET auth_user_id = ?, cloud_profile_id = ?, cloud_role = ?, member_no = ?,
              display_name = ?, last_sign_in_at = ?
        WHERE id = ?`
    ).run(uid, profile.id, profile.role, profile.member_no, displayName, now, byEmail.id)
    return byEmail.id
  }

  const id = randomUUID()
  const { hash, salt } = hashPassword(randomBytes(32).toString('base64url'))
  const username = freeUsername(profile.username || email.split('@')[0] || USERNAME_FALLBACK)

  db.prepare(
    `INSERT INTO users
       (id, username, display_name, email, password_hash, password_salt,
        created_at, password_changed_at, last_sign_in_at, avatar,
        auth_user_id, cloud_profile_id, cloud_role, member_no)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'initials', ?, ?, ?, ?)`
  ).run(
    id,
    username,
    displayName,
    email,
    hash,
    salt,
    now,
    now,
    now,
    uid,
    profile.id,
    profile.role,
    profile.member_no
  )

  return id
}

/** A local username that does not collide, since the two tables have different rules. */
function freeUsername(candidate: string): string {
  const db = getDatabase()
  const base = candidate
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 20) || USERNAME_FALLBACK

  let value = base
  let counter = 1
  while (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(value)) {
    counter += 1
    value = `${base.slice(0, 18)}${counter}`
    if (counter > 500) {
      value = `${base.slice(0, 12)}${randomBytes(3).toString('hex')}`
      break
    }
  }
  return value
}

/**
 * Finishes a sign-in that already produced tokens: profile, mirror, session.
 *
 * The order matters. The mirror is written before the sealed session so a crash
 * between the two leaves an account row with no session (a sign-in prompt) and
 * never a session pointing at a user that does not exist.
 */
async function completeSignIn(
  payload: AuthTokenPayload,
  email: string
): Promise<AccountSignInResult> {
  const provisional = sessionFromToken(payload, {
    email,
    profileId: '',
    memberNo: '',
    role: 'member',
    displayName: '',
    username: ''
  })
  const profile = await ensureProfile(provisional)
  if (profile.suspended_at) throw errors.accountSuspended()

  const session: AccountSession = {
    ...provisional,
    profileId: profile.id,
    memberNo: profile.member_no,
    role: profile.role,
    displayName: profile.display_name || profile.username || email,
    username: profile.username
  }

  const localUserId = mirrorLocalUser(profile, email, session.uid)
  saveAccount(session)
  await touchContactEmail(session)

  const user: SessionUser | null = findUserById(localUserId)
  if (!user) throw errors.cloud('The account signed in but could not be opened on this PC.')

  /* Open the session first: pulling needs somebody to pull as. */
  const opened = openSessionFor(user.id)

  /*
   * A new PC catches up before the dashboard opens: whatever this account saved
   * from another machine is pulled now, so "sign in and continue where you left
   * off" is true the moment the window appears. Capped, because a slow network
   * must delay the window by seconds, not keep it shut.
   */
  await Promise.race([
    syncAfterSignIn().catch(() => 0),
    new Promise<number>((resolve) => setTimeout(() => resolve(0), 4000))
  ])

  return { user: opened, state: accountStateFor(session, readStoredAccount()) }
}

async function requestToken(path: string, body: Record<string, unknown>): Promise<AuthTokenPayload> {
  return supabaseRequest<AuthTokenPayload>(path, { method: 'POST', body })
}

/**
 * Signing in with the INDRA account.
 *
 * Supabase answers 400 for a wrong password and for an unknown address alike,
 * which is the right answer: this screen must not become a way to test whether
 * somebody has an account.
 */
export async function signInAccount(input: AccountCredentialsInput): Promise<AccountSignInResult> {
  requireConnection()
  const email = cleanEmail(input?.email ?? '')
  const password = input?.password ?? ''
  if (!password) throw errors.validation('Enter your password.', 'password')

  let payload: AuthTokenPayload
  try {
    payload = await requestToken('/auth/v1/token?grant_type=password', { email, password })
  } catch (error) {
    mapAuthFailure(error, 'signIn')
  }

  return completeSignIn(payload, email)
}

/**
 * Creating the account.
 *
 * If the project requires email confirmation, Supabase returns a user and no
 * session. That is not a failure, so it is reported as the next step rather
 * than as an error the person cannot act on.
 */
export async function createAccount(input: AccountCreateInput): Promise<AccountSignInResult> {
  requireConnection()
  const email = cleanEmail(input?.email ?? '')
  const password = input?.password ?? ''
  if (password.length < 8) {
    throw errors.validation('Use a password of at least 8 characters.', 'password')
  }

  const displayName = (input.displayName ?? '').trim().slice(0, 48)
  const username = (input.username ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')

  let payload: AuthTokenPayload
  try {
    payload = await requestToken('/auth/v1/signup', {
      email,
      password,
      data: {
        ...(displayName ? { full_name: displayName } : {}),
        ...(username ? { username } : {})
      }
    })
  } catch (error) {
    mapAuthFailure(error, 'signUp')
  }

  if (!payload.access_token) {
    throw errors.validation(
      'Account created. Confirm the address in the email the server sent, then sign in.',
      'email'
    )
  }

  return completeSignIn(payload, email)
}

/**
 * Creating an account is creating it on the server.
 *
 * Registration used to stop at the local database, and the server half lived
 * behind a separate button in Account & cloud that was easy to never press. That
 * is how a project can accumulate accounts the server has never heard of — the
 * app signs in, the panel opens, and nothing about that person exists anywhere
 * but their own disk.
 *
 * So the two halves happen in one action now. If the server refuses, the local
 * half is deleted rather than left behind, because an account that exists only
 * on one PC is worse than an error message.
 *
 * The one refusal that is not a failure is email confirmation: the account
 * genuinely exists on the server, it simply cannot be signed in to until the
 * address is confirmed, so the message says exactly that.
 */
export async function registerOnServer(input: RegisterInput): Promise<SessionUser> {
  /*
   * The activation key is the server's, checked and consumed there.
   *
   * It used to be checked against this PC's own key table, which meant a key
   * minted on the administrator's machine was unknown to every other machine,
   * and a key spent here was still listed as unused everywhere else. The check
   * happens before anything is created, and the redemption after — with the new
   * account's own token, so the row records who used it.
   */
  const settings = readSettings()
  const needsKey = settings.requireActivationKey
  const suppliedKey = (input?.activationKey ?? '').trim()

  if (needsKey) {
    if (!suppliedKey) throw errors.validation('Enter your activation key.', 'activationKey')
    const usable = await checkServerActivationKey(suppliedKey)
    if (!usable) {
      throw errors.validation(
        'That activation key is not valid, has already been used, or has expired.',
        'activationKey'
      )
    }
  }

  const user = register(needsKey ? input : input, { keyCheckedOnServer: needsKey })
  try {
    await createAccountFromLocal(input.password ?? '')
    /*
     * The server holds the password now, and it is the only place that should.
     * What stays here is a hash of bytes nobody kept, so this PC cannot be used
     * as a credential store for somebody's account.
     */
    clearLocalPassword(user.id)

    if (needsKey) {
      const live = await liveAccount().catch(() => null)
      const redeemed = live?.accessToken
        ? await redeemServerActivationKey(suppliedKey, live.accessToken).catch(() => false)
        : false
      if (!redeemed) {
        /*
         * Two people raced for the same code. The account that was just made
         * must not survive without a key, so it is taken back off the server
         * and off this PC before the person is told to try another one.
         */
        if (live?.accessToken) {
          await supabaseRequest('/rest/v1/rpc/indra_delete_my_account', {
            method: 'POST',
            body: {},
            token: live.accessToken
          }).catch(() => undefined)
        }
        discardLocalAccount(user.id)
        throw errors.validation(
          'That activation key was used by someone else a moment ago. Try another one.',
          'activationKey'
        )
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/confirm the address/i.test(message)) throw error
    discardLocalAccount(user.id)
    throw error
  }
  return findUserById(user.id) ?? user
}

/**
 * Turning the local account already in use into an INDRA account.
 *
 * The local password is checked against the local hash first — the person is
 * proving they are the account they are already signed in as — and is then used
 * once to create the server account with the same address. That address match
 * is what lets `mirrorLocalUser` adopt the existing row, so the projects written
 * before the migration stay attached to the same person.
 */
export async function createAccountFromLocal(password: string): Promise<AccountSignInResult> {
  const sessionUserId = activeSessionUserId()
  if (!sessionUserId) throw errors.authRequired()
  const row = getDatabase()
    .prepare(
      'SELECT id, email, display_name, username, password_hash, password_salt, auth_user_id FROM users WHERE id = ?'
    )
    .get(sessionUserId) as
    | {
        id: string
        email: string
        display_name: string
        username: string
        password_hash: string
        password_salt: string
        auth_user_id: string | null
      }
    | undefined

  if (!row) throw errors.authRequired()
  if (row.auth_user_id) throw errors.conflict('This account is already connected to INDRA.')

  if (!verifyPassword(password ?? '', { hash: row.password_hash, salt: row.password_salt })) {
    throw errors.validation('That is not this account’s password.', 'password')
  }

  return createAccount({
    email: row.email,
    password,
    displayName: row.display_name,
    username: row.username
  })
}

/**
 * Signing out of the server.
 *
 * The refresh tokens are revoked first (best effort — an offline sign-out must
 * still work), then the sealed session is deleted, then the local session is
 * closed. Doing it in that order means a failure at the server cannot leave the
 * app "signed in" with a token it has already tried to revoke.
 */
export async function signOutOfAccount(): Promise<void> {
  const stored = readStoredAccount()
  if (stored.session && recheckConnectivity().online) {
    try {
      await supabaseRequest('/auth/v1/logout', {
        method: 'POST',
        token: stored.session.accessToken
      })
    } catch {
      // A token that could not be revoked will expire on its own.
    }
  }

  clearAccount()
  signOut()
}

/** The signed-in account as the renderer sees it. */
export function currentAccountState(): AccountState {
  const stored = readStoredAccount()
  return accountStateFor(stored.session, stored)
}
