import { randomUUID } from 'node:crypto'
import type {
  ChangePasswordInput,
  DeleteAccountInput,
  LoginInput,
  ProfileInput,
  RegisterInput,
  SessionUser
} from '@shared/types'
import { getDatabase } from '../db/database'
import { errors } from '../lib/errors'
import { hashPassword, verifyPassword } from '../lib/password'
import { EMAIL_PATTERN, normalizeEmail, validateRegistration } from '../lib/validation'
import { consumeActivationKey, findUsableKey } from './activation'
import { findUserById } from './users'
import { readSettings } from './settings'

const SESSION_KEY = 'session'
const SESSION_DAYS = 30
const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15

interface SessionRecord {
  userId: string
  expiresAt: string
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

function writeSession(userId: string): void {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString()
  getDatabase()
    .prepare(
      `INSERT INTO app_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(SESSION_KEY, JSON.stringify({ userId, expiresAt } satisfies SessionRecord))
}

function lockMessage(minutes: number): string {
  return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
}

export function register(input: RegisterInput): SessionUser {
  const settings = readSettings()
  if (settings.maintenanceMode) throw errors.maintenance()
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

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO users
         (id, username, display_name, email, password_hash, password_salt,
          created_at, password_changed_at, last_sign_in_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, username, displayName, email, hash, salt, now, now, now)

    if (keyId) consumeActivationKey(keyId, id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  writeSession(id)
  const user = findUserById(id)
  if (!user) throw new Error('account vanished after insert')
  return user
}

export function signIn(input: LoginInput): SessionUser {
  // The administrator can close the app to ordinary users; the check lives
  // here rather than in the renderer so it cannot be bypassed.
  if (readSettings().maintenanceMode) throw errors.maintenance()

  const identifier = (input.identifier ?? '').trim()
  const password = input.password ?? ''
  if (!identifier || !password) {
    throw errors.validation('Enter your username and password.')
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

export function updateProfile(viewer: SessionUser, input: ProfileInput): SessionUser {
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

  db.prepare('UPDATE users SET display_name = ?, email = ? WHERE id = ?').run(
    displayName,
    email,
    viewer.id
  )

  const user = findUserById(viewer.id)
  if (!user) throw errors.authRequired()
  return user
}

export function changeOwnPassword(viewer: SessionUser, input: ChangePasswordInput): void {
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

export function deleteOwnAccount(viewer: SessionUser, input: DeleteAccountInput): void {
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
