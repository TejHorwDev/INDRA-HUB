import { randomBytes, randomUUID } from 'node:crypto'
import type {
  ChangePasswordInput,
  DeleteAccountInput,
  LoginInput,
  ProfileInput,
  RegisterInput,
  SessionUser
} from '@shared/types'
import { getDatabase } from '../db/database'
import { publishPortrait } from './cloud'
import { liveAccount } from '../lib/accountSession'
import { supabaseRequest } from '../lib/supabase'
import { errors } from '../lib/errors'
import { hashPassword, verifyPassword } from '../lib/password'
import { EMAIL_PATTERN, normalizeEmail, validateRegistration } from '../lib/validation'
import { consumeActivationKey, findUsableKey } from './activation'
import { findUserById } from './users'
import { readSettings } from './settings'
import { recheckConnectivity } from './connectivity'
import { ensureOfflineProfile, isOfflineUserId } from './offline'
import { PORTRAIT_PATTERN, installPortrait, readPortraitFile, removePortrait } from './portrait'
import { OFFLINE_USERNAME } from '@shared/offline'

const SESSION_KEY = 'session'
const SESSION_DAYS = 30
const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15

interface SessionRecord {
  userId: string
  expiresAt: string
  /** Absent means an account session, which is the only kind that existed first. */
  mode?: 'account' | 'offline'
}

interface AccountRow {
  id: string
  username: string
  email: string
  password_hash: string
  password_salt: string
  failed_login_count: number
  locked_until: string | null
}

function readSession(): SessionRecord | null {
  const row = getDatabase().prepare('SELECT value FROM app_state WHERE key = ?').get(SESSION_KEY) as
    | { value: string }
    | undefined
  if (!row) return null

  try {
    const record = JSON.parse(row.value) as SessionRecord
    if (!record.userId || !record.expiresAt) return null
    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      signOut()
      return null
    }
    return record
  } catch {
    return null
  }
}

function writeSession(userId: string, mode: 'account' | 'offline' = 'account'): void {
  const days = mode === 'offline' ? 1 : SESSION_DAYS
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString()
  getDatabase()
    .prepare(
      `INSERT INTO app_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(SESSION_KEY, JSON.stringify({ userId, expiresAt, mode } satisfies SessionRecord))
}

/**
 * Signing in and registering are online acts.
 *
 * With no route out there is nothing to prove and nothing to reach: the account
 * lives in this file, so checking a password against it would "work" and would
 * prove only that some hash matched. Offline the app offers the writing tools
 * instead, and this refusal is what makes that true below the UI as well.
 */
function requireConnectionForCredentials(): void {
  if (!recheckConnectivity().online) {
    throw errors.offline(
      'Signing in needs a connection. You can work offline instead — your writing saves on this PC.'
    )
  }
}

/**
 * Opens the offline workspace: the local profile that owns offline work, with a
 * session marked as such so the rest of the app knows there is no account here.
 */
export function startOfflineWorkspace(): SessionUser {
  const profile = ensureOfflineProfile()
  writeSession(profile.id, 'offline')
  const user = findUserById(profile.id)
  if (!user) throw new Error('offline profile vanished')
  return user
}

/** An offline session does not survive a restart into a connection. */
export function dropStaleOfflineSession(): void {
  const session = readSession()
  if (!session || session.mode !== 'offline') return
  if (recheckConnectivity().online) signOut()
}

/**
 * Copies a freshly chosen picture up to the workspace server, in the background.
 *
 * Deliberately fire-and-forget: the local file is the picture the account shows,
 * and a slow or absent connection must never make choosing one feel broken. The
 * call is skipped entirely for anything that is not an installed photo, so
 * `initials` costs nothing.
 */
function publishPortraitInBackground(viewer: SessionUser, value: string): void {
  if (!value.startsWith('photo:')) return
  const id = value.slice('photo:'.length)
  const file = readPortraitFile(id)
  if (!file) return
  void publishPortrait(viewer, id, file.bytes, file.mime).catch(() => undefined)
}

/**
 * Turns what a request carried into the string an account stores.
 *
 * A photo is written before the account row exists, so a database failure has
 * to be able to take the file back with it. Every other value is one the
 * renderer can draw, checked here because the renderer is not trusted to have
 * checked anything.
 */
function avatarValue(input: {
  avatar?: string | null
  avatarPhoto?: { bytes?: Uint8Array; name?: string } | null
}): { value: string; installed: boolean } {
  if (input.avatarPhoto?.bytes && input.avatarPhoto.bytes.length > 0) {
    return {
      value: installPortrait(input.avatarPhoto.bytes, input.avatarPhoto.name),
      installed: true
    }
  }
  const value = (input.avatar ?? 'initials').trim() || 'initials'
  if (!PORTRAIT_PATTERN.test(value)) {
    throw errors.validation('That portrait is not one the app can draw.', 'avatar')
  }
  return { value, installed: false }
}

function lockMessage(minutes: number): string {
  return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
}

export function register(input: RegisterInput): SessionUser {
  requireConnectionForCredentials()
  const settings = readSettings()
  // Maintenance closes the workspace, never the front door: an account created
  // during it simply lands on the maintenance screen like everyone else.
  if (!settings.allowRegistration) throw errors.registrationClosed()

  const { username, displayName, email } = validateRegistration(input)
  const db = getDatabase()

  const usernameTaken = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)
  if (usernameTaken) throw errors.conflict('That username is taken.', 'username')

  const emailTaken = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)
  if (emailTaken) throw errors.conflict('An account with that email already exists.', 'email')

  // Activation keys are optional app-wide; when required, the account and the
  // key are consumed in one transaction so neither can exist without the other.
  let keyId: string | null = null
  if (settings.requireActivationKey) {
    const provided = (input.activationKey ?? '').trim()
    if (!provided) throw errors.validation('Enter your activation key.', 'activationKey')
    const key = findUsableKey(provided)
    if (!key) {
      throw errors.validation(
        'That activation key is not valid, has already been used, or has expired.',
        'activationKey'
      )
    }
    keyId = key.id
  }

  const { hash, salt } = hashPassword(input.password)
  const id = randomUUID()
  const now = new Date().toISOString()

  // Chosen before the account exists and stored with it, so an account is
  // never created without the portrait its owner just picked.
  const portrait = avatarValue(input)

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO users
         (id, username, display_name, email, password_hash, password_salt,
          created_at, password_changed_at, last_sign_in_at, avatar)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, username, displayName, email, hash, salt, now, now, now, portrait.value)

    if (keyId) consumeActivationKey(keyId, id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    if (portrait.installed) removePortrait(portrait.value)
    throw error
  }

  writeSession(id)
  const user = findUserById(id)
  if (!user) throw new Error('account vanished after insert')
  if (portrait.installed) publishPortraitInBackground(user, portrait.value)
  return user
}

/**
 * Deleting an account that never reached the server.
 *
 * Registration is local-then-server so the password hash and the portrait are
 * written once, with the rest of the account. When the server refuses — the
 * address is taken, the password was rejected — the local half must not
 * survive: an account that exists only on this PC is exactly the trap this
 * project has been digging itself out of.
 */
/**
 * Forgets the local copy of a password that now lives on the server.
 *
 * The row keeps a hash because the column exists and predates server accounts;
 * what is stored is 32 random bytes that were thrown away immediately, so there
 * is nothing on this disk to guess, crack, or reuse.
 */
export function clearLocalPassword(userId: string): void {
  const { hash, salt } = hashPassword(randomBytes(32).toString('base64url'))
  getDatabase()
    .prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
    .run(hash, salt, userId)
}

export function discardLocalAccount(userId: string): void {
  const db = getDatabase()
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(userId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  signOut()
}

export function signIn(input: LoginInput): SessionUser {
  /*
   * Signing in always works, including during maintenance. Refusing here left
   * people staring at a wall with no way to prove who they were, and it made
   * the maintenance screen the only thing they could reach. What maintenance
   * closes is the workspace, and that is enforced by requireUser() for every
   * data call — below this, not in front of it.
   */
  requireConnectionForCredentials()

  const identifier = (input.identifier ?? '').trim()
  const password = input.password ?? ''
  if (!identifier || !password) {
    throw errors.validation('Enter your username and password.')
  }
  // The offline workspace has no usable password by construction; this makes it
  // explicit rather than a puzzle about a random hash.
  if (identifier.toLowerCase() === OFFLINE_USERNAME) {
    throw errors.invalidCredentials()
  }

  // Email or username — both are unique and case-insensitive.
  const account = getDatabase()
    .prepare(
      `SELECT id, username, email, password_hash, password_salt, failed_login_count, locked_until
         FROM users
        WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE
        LIMIT 1`
    )
    .get(identifier, normalizeEmail(identifier)) as AccountRow | undefined

  if (!account) throw errors.invalidCredentials()

  const lockedUntil = account.locked_until ? new Date(account.locked_until).getTime() : 0
  if (lockedUntil > Date.now()) {
    const minutes = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60_000))
    throw errors.throttled(lockMessage(minutes))
  }

  // A lock that has expired starts the count again.
  const previousFailures =
    account.locked_until && lockedUntil <= Date.now() ? 0 : Number(account.failed_login_count ?? 0)

  if (!verifyPassword(password, { hash: account.password_hash, salt: account.password_salt })) {
    const failures = previousFailures + 1
    const lock = failures >= MAX_FAILED_ATTEMPTS
    const lockUntil = lock ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null
    getDatabase()
      .prepare('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?')
      .run(failures, lockUntil, account.id)

    if (lock) throw errors.throttled(lockMessage(LOCK_MINUTES))
    throw errors.invalidCredentials()
  }

  if (isSuspended(account.id)) throw errors.accountSuspended()

  const now = new Date().toISOString()
  getDatabase()
    .prepare(
      'UPDATE users SET failed_login_count = 0, locked_until = NULL, last_sign_in_at = ? WHERE id = ?'
    )
    .run(now, account.id)

  writeSession(account.id)
  const user = findUserById(account.id)
  if (!user) throw errors.invalidCredentials()
  return user
}

function isSuspended(userId: string): boolean {
  const row = getDatabase()
    .prepare('SELECT suspended_at FROM users WHERE id = ?')
    .get(userId) as { suspended_at: string | null } | undefined
  return Boolean(row?.suspended_at)
}

/** The renderer never sees a token: the main process owns the session. */
export function currentUser(): SessionUser | null {
  const session = readSession()
  if (!session) return null

  // A suspended account loses its session immediately, not at next sign-in.
  if (isSuspended(session.userId)) {
    signOut()
    return null
  }

  return findUserById(session.userId)
}

export function signOut(): void {
  getDatabase().prepare('DELETE FROM app_state WHERE key = ?').run(SESSION_KEY)
}

/**
 * Opens the ordinary app session for an account that was authenticated
 * somewhere else — today, the INDRA account sign-in, which proves the identity
 * against the server and then needs the session every guard in the app reads.
 *
 * The session is the same kind a local sign-in writes, so nothing downstream
 * has to know how the person got in.
 */
export function openSessionFor(userId: string): SessionUser {
  const user = findUserById(userId)
  if (!user) throw errors.authRequired()
  writeSession(user.id)
  return user
}

export function requireUser(): SessionUser {
  const user = currentUser()
  if (!user) throw errors.authRequired()
  if (readSettings().maintenanceMode) throw errors.maintenance()
  return user
}

/** The signed-in account id, or null — used by the admin overview. */
export function activeSessionUserId(): string | null {
  return readSession()?.userId ?? null
}

/* ------------------------------------------------------------------ */
/* Self-service                                                        */
/* ------------------------------------------------------------------ */

function assertRealAccount(viewer: SessionUser): void {
  if (viewer.mode === 'offline' || isOfflineUserId(viewer.id)) {
    throw errors.forbidden('This is the offline workspace, not an account. Sign in to manage one.')
  }
}

export function updateProfile(viewer: SessionUser, input: ProfileInput): SessionUser {
  assertRealAccount(viewer)
  const displayName = (input.displayName ?? '').trim().replace(/\s+/g, ' ')
  const email = normalizeEmail(input.email ?? '')

  if (displayName.length < 2 || displayName.length > 48) {
    throw errors.validation('Name must be 2–48 characters.', 'displayName')
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw errors.validation('Enter a valid email address.', 'email')
  }

  const db = getDatabase()
  const taken = db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(email, viewer.id)
  if (taken) throw errors.conflict('Another account already uses that email.', 'email')

  /*
   * The portrait is an id, not bytes: `initials`, one of the marks the renderer
   * knows how to draw, or a photo already copied into the app. Anything else is
   * refused rather than stored, so a malformed value can never reach a screen
   * that renders it.
   */
  const previous = findUserById(viewer.id)
  if (!previous) throw errors.authRequired()

  const portrait =
    input.avatar !== undefined || input.avatarPhoto
      ? avatarValue(input)
      : { value: previous.avatar ?? 'initials', installed: false }

  try {
    if (portrait.value !== previous.avatar) {
      db.prepare('UPDATE users SET display_name = ?, email = ?, avatar = ? WHERE id = ?').run(
        displayName,
        email,
        portrait.value,
        viewer.id
      )
    } else {
      db.prepare('UPDATE users SET display_name = ?, email = ? WHERE id = ?').run(
        displayName,
        email,
        viewer.id
      )
    }
  } catch (error) {
    // Never keep a file for a change that did not happen.
    if (portrait.installed) removePortrait(portrait.value)
    throw error
  }

  // The old photo is forgotten only once the new value is the one on the row.
  if (portrait.value !== previous.avatar) removePortrait(previous.avatar)

  if (portrait.installed) publishPortraitInBackground(viewer, portrait.value)

  const user = findUserById(viewer.id)
  if (!user) throw errors.authRequired()
  return user
}

export function changeOwnPassword(viewer: SessionUser, input: ChangePasswordInput): void {
  assertRealAccount(viewer)
  const currentPassword = input.currentPassword ?? ''
  const newPassword = input.newPassword ?? ''

  const account = getDatabase()
    .prepare('SELECT password_hash, password_salt FROM users WHERE id = ?')
    .get(viewer.id) as { password_hash: string; password_salt: string } | undefined
  if (!account) throw errors.authRequired()

  if (!verifyPassword(currentPassword, { hash: account.password_hash, salt: account.password_salt })) {
    throw errors.validation('Current password is incorrect.', 'currentPassword')
  }
  if (newPassword.length < 8 || newPassword.length > 200) {
    throw errors.validation('Use at least 8 characters.', 'newPassword')
  }
  if (newPassword === currentPassword) {
    throw errors.validation('Choose a new password that differs from the current one.', 'newPassword')
  }

  const { hash, salt } = hashPassword(newPassword)
  getDatabase()
    .prepare(
      'UPDATE users SET password_hash = ?, password_salt = ?, password_changed_at = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?'
    )
    .run(hash, salt, new Date().toISOString(), viewer.id)
}

export async function deleteOwnAccount(viewer: SessionUser, input: DeleteAccountInput): Promise<void> {
  assertRealAccount(viewer)
  const db = getDatabase()
  const account = db
    .prepare('SELECT password_hash, password_salt FROM users WHERE id = ?')
    .get(viewer.id) as { password_hash: string; password_salt: string } | undefined
  if (!account) throw errors.authRequired()

  if (!verifyPassword(input.password ?? '', { hash: account.password_hash, salt: account.password_salt })) {
    throw errors.validation('Password is incorrect.', 'password')
  }

  const owned = (
    db.prepare('SELECT COUNT(*) AS total FROM projects WHERE owner_id = ?').get(viewer.id) as {
      total: number
    }
  ).total
  const created = (
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM documents WHERE created_by = ?) +
           (SELECT COUNT(*) FROM presentations WHERE created_by = ?) AS total`
      )
      .get(viewer.id, viewer.id) as { total: number }
  ).total

  if (Number(owned) + Number(created) > 0) {
    throw errors.conflict(
      'This account still owns projects or created content. Transfer or delete them before deleting the account.'
    )
  }

  /*
   * The account that can sign in is the server's, so that is the one that has to
   * go. Deleting only the local row left the address and password working: the
   * next sign-in made a new local row and the person was back, on this PC and on
   * any other.
   *
   * The server function deletes the caller's own auth row — it takes no id, so it
   * cannot be aimed at anybody else — and refuses while they still own projects.
   */
  const live = await liveAccount().catch(() => null)
  if (live?.accessToken) {
    try {
      await supabaseRequest('/rest/v1/rpc/indra_delete_my_account', {
        method: 'POST',
        body: {},
        token: live.accessToken
      })
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      if (/owns_projects/.test(text)) {
        throw errors.conflict(
          'This account still owns projects on the server. Transfer or delete those first.'
        )
      }
      if (/not_signed_in/.test(text)) {
        throw errors.authRequired()
      }
      throw new Error(`The server did not delete the account: ${text}`)
    }
  } else {
    throw errors.cloud(
      'Deleting the account needs the server. Reconnect and sign in again, then delete it.'
    )
  }

  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM project_members WHERE user_id = ?').run(viewer.id)
    db.prepare('DELETE FROM users WHERE id = ?').run(viewer.id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  signOut()
}
