import { randomBytes, randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { signInAccount } from './account'
import {
  adminCloudRequest,
  adminCloudRole,
  adminDeleteCloudDocument,
  adminDeleteCloudPresentation,
  adminDeleteCloudProject,
  adminRenameCloudProject,
  adminTransferCloudProject
} from './cloud'
import type {
  AdminAccount,
  AdminAccountRow,
  AdminIdentityInput,
  AdminAuditAction,
  AdminAuditEntry,
  AdminContentRow,
  AdminLoginInput,
  AdminOverview,
  AdminProjectRow,
  AdminSetupInput,
  AdminSettings,
  AdminStatus,
  AdminSystemInfo,
  ActivationKeyRow,
  AppearanceTreatment,
  CreateActivationKeyInput,
  CreatedActivationKey,
  LoginAppearance
} from '@shared/types'
import { getDatabase } from '../db/database'
import { runningVersion } from '../lib/payload'
import { errors } from '../lib/errors'
import { hashPassword, verifyPassword } from '../lib/password'
import { EMAIL_PATTERN, normalizeEmail, validateProjectInput } from '../lib/validation'
import { activeSessionUserId, signOut } from './auth'
import {
  installLoginBackground,
  readLoginAppearance,
  removeLoginBackground,
  writeTreatment
} from './appearance'
import { readSettings, writeSettings } from './settings'
import {
  listActivationKeys,
  mirrorServerKeys,
  requireServerKeys,
  type ServerKeyRow
} from './activation'

/*
 * Administration is a separate identity, not a role on a normal account.
 * It has its own table, its own session key and its own short expiry, so a
 * signed-in user has no path to these queries and an admin session never
 * grants access to project data through the ordinary services.
 *
 * Every mutation below re-checks the admin session and writes an audit row.
 */

/**
 * The built-in administrator.
 *
 * This installation ships with one administrator identity so that a fresh copy
 * is never left without a way into the administration area, and so that nothing
 * on the sign-in screen has to advertise one. The password is hashed with scrypt
 * before it is ever written — the database never holds the plain text — and it
 * can be replaced from Admin → Access & controls at any time, which is what to
 * do before handing a copy of the app to anyone else.
 */
const BUILT_IN_ADMIN_EMAIL = 'admintej@gmail.com'
const BUILT_IN_ADMIN_PASSWORD = 'AAaa1234@$'
const BUILT_IN_ADMIN_NAME = 'Administrator'
/** Set by an explicit reset, so the built-in account is not resurrected behind it. */
const SEED_SUPPRESSED_KEY = 'admin_seed_suppressed'

const SESSION_KEY = 'admin_session'
const THROTTLE_KEY = 'admin_throttle'
const SESSION_HOURS = 12
const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 15
const STARTED_AT = new Date().toISOString()

interface AdminRow {
  id: string
  email: string
  display_name: string
  password_hash: string
  password_salt: string
  created_at: string
  last_sign_in_at: string | null
}

interface AdminSessionRecord {
  adminId: string
  expiresAt: string
}

interface ThrottleRecord {
  failures: number
  lockedUntil: string | null
}

interface UserRow {
  id: string
  username: string
  display_name: string
  email: string
  created_at: string
  suspended_at: string | null
}

function readState<T>(key: string): T | null {
  const row = getDatabase().prepare('SELECT value FROM app_state WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value) as T
  } catch {
    return null
  }
}

function writeState(key: string, value: unknown): void {
  getDatabase()
    .prepare(
      `INSERT INTO app_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, JSON.stringify(value))
}

function clearState(key: string): void {
  getDatabase().prepare('DELETE FROM app_state WHERE key = ?').run(key)
}

function adminRow(): AdminRow | null {
  return (
    (getDatabase()
      .prepare(
        `SELECT id, email, display_name, password_hash, password_salt, created_at, last_sign_in_at
           FROM admin_users
          ORDER BY created_at ASC
          LIMIT 1`
      )
      .get() as AdminRow | undefined) ?? null
  )
}

function toAccount(row: AdminRow): AdminAccount {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at
  }
}

function audit(action: AdminAuditAction, detail: string, adminId: string | null): void {
  getDatabase()
    .prepare('INSERT INTO admin_audit (id, admin_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), adminId, action, detail.slice(0, 300), new Date().toISOString())
}

function readSession(): AdminSessionRecord | null {
  const record = readState<AdminSessionRecord>(SESSION_KEY)
  if (!record?.adminId || !record.expiresAt) return null
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    clearState(SESSION_KEY)
    return null
  }
  return record
}

function writeSession(adminId: string): void {
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000).toISOString()
  writeState(SESSION_KEY, { adminId, expiresAt } satisfies AdminSessionRecord)
}

/**
 * Creates the built-in administrator if this installation has none.
 *
 * Runs once, at startup, before any window exists. An installation that already
 * has an administrator — including one an operator created or replaced — is left
 * exactly as it is. Called again after `--reset-admin` it does nothing, because
 * that flag means "let me choose", not "put the shipped account back".
 */
/**
 * There used to be a seeded administrator here, with a password written into the
 * build. Every installation therefore shipped the same credentials, which is the
 * opposite of an administrator and exactly the kind of thing that turns into a
 * support incident. Administrating is now an account on the server; nothing is
 * seeded, and this remains only so old callers keep compiling.
 */
export function ensureBuiltInAdmin(): boolean {
  return false
}

export function adminStatus(): AdminStatus {
  /*
   * There is nothing to set up any more: the administrator is an account on the
   * server, and the panel's only question is whether somebody has signed in as
   * one. So the gate is always ready, and the first screen is the sign-in form
   * rather than a local setup that would create credentials on this PC.
   */
  const row = adminRow()
  const session = readSession()
  const signedIn = Boolean(row && session?.adminId === row.id)
  return { configured: true, signedIn, admin: signedIn && row ? toAccount(row) : null }
}

/**
 * First run only. The one administrator is created here with a Gmail address
 * and a scrypt-hashed password — there is no seeded or default credential.
 */
export function setupAdmin(input: AdminSetupInput): AdminAccount {
  if (adminRow()) {
    throw errors.conflict('Administrator access is already configured on this installation.')
  }

  const email = normalizeEmail(input.email ?? '')
  const displayName = (input.displayName ?? '').trim().replace(/\s+/g, ' ')
  const password = input.password ?? ''

  if (!EMAIL_PATTERN.test(email)) {
    throw errors.validation('Enter a valid email address.', 'email')
  }
  if (!email.endsWith('@gmail.com')) {
    throw errors.validation('Administrator access uses a Gmail address.', 'email')
  }
  if (displayName.length < 2 || displayName.length > 48) {
    throw errors.validation('Name must be 2–48 characters.', 'displayName')
  }
  if (password.length < 10 || password.length > 200) {
    throw errors.validation('Use at least 10 characters for the admin password.', 'password')
  }
  if (password !== (input.confirmPassword ?? '')) {
    throw errors.validation('The two passwords do not match.', 'confirmPassword')
  }

  const { hash, salt } = hashPassword(password)
  const id = randomUUID()
  const now = new Date().toISOString()

  getDatabase()
    .prepare(
      `INSERT INTO admin_users
         (id, email, display_name, password_hash, password_salt, created_at, last_sign_in_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, email, displayName, hash, salt, now, now)

  audit('setup', `Administrator ${email} created on this installation.`, id)
  writeSession(id)

  const row = adminRow()
  if (!row) throw new Error('administrator vanished after insert')
  return toAccount(row)
}

/**
 * The address the server reserves for administration, if it reserves one.
 *
 * Asking the server rather than reading a constant is what makes a change of
 * administrator a database edit instead of a new release.
 */
function reservedAdminEmail(): string | null {
  return readState<{ email?: string }>('admin:reserved')?.email ?? null
}

export async function refreshReservedAdmin(): Promise<void> {
  try {
    const who = await adminCloudRequest<{ email?: string } | null>(
      requireAdminRowIdOrEmpty(),
      '/rest/v1/rpc/indra_admin_who',
      { method: 'POST', body: {} }
    )
    const email = typeof who?.email === 'string' ? who.email.toLowerCase() : ''
    if (email) writeState('admin:reserved', { email })
  } catch {
    // The panel still works with what it knows; this is only a shortcut.
  }
}

function requireAdminRowIdOrEmpty(): string {
  try {
    return readSession()?.adminId ?? adminRow()?.id ?? ''
  } catch {
    return ''
  }
}

export async function adminSignIn(input: AdminLoginInput): Promise<AdminAccount> {
  const throttle = readState<ThrottleRecord>(THROTTLE_KEY)
  if (throttle?.lockedUntil) {
    const remaining = new Date(throttle.lockedUntil).getTime() - Date.now()
    if (remaining > 0) {
      const minutes = Math.max(1, Math.ceil(remaining / 60_000))
      throw errors.throttled(
        `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
      )
    }
    clearState(THROTTLE_KEY)
  }

  const email = normalizeEmail(input.email ?? '')
  const password = input.password ?? ''
  if (!email || !password) {
    throw errors.validation('Enter the administrator email and password.')
  }

  /*
   * The password is checked by the server. Nothing here compares it to a hash
   * on this disk, because a hash on this disk proves only that this machine
   * once accepted it — it says nothing about whether the account still exists,
   * or is still an administrator, anywhere else.
   */
  let signedIn: { user: { id: string; displayName?: string } }
  try {
    signedIn = await signInAccount({ email, password })
  } catch {
    throw rejectAdminAttempt('Rejected administrator sign-in attempt.')
  }

  const role = await adminCloudRole(signedIn.user.id).catch(() => null)
  if (role?.isAdmin !== true) {
    throw rejectAdminAttempt('Refused administrator sign-in: the account is not an administrator.')
  }

  clearState(THROTTLE_KEY)
  const row = adoptAdminRow(email, signedIn.user.displayName || 'Administrator')
  writeSession(row.id)
  audit('sign_in', 'Administrator signed in with a server account.', row.id)
  return toAccount(row)
}

/** One place for the throttle, the audit line and the sentence the person sees. */
function rejectAdminAttempt(reason: string): Error {
  const failures = (readState<ThrottleRecord>(THROTTLE_KEY)?.failures ?? 0) + 1
  const locked = failures >= MAX_ATTEMPTS
  writeState(THROTTLE_KEY, {
    failures,
    lockedUntil: locked ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null
  } satisfies ThrottleRecord)
  audit('sign_in_failed', reason, adminRow()?.id ?? 'server')
  if (locked) {
    return errors.throttled(
      `Too many attempts. Administrator sign-in is locked for ${LOCK_MINUTES} minutes.`
    )
  }
  return errors.adminInvalidCredentials()
}

/**
 * The local row the panel's session hangs from.
 *
 * It holds no usable password: sign-in has already happened on the server by the
 * time this runs, and the random hash below is there to satisfy a column that
 * predates server accounts. Nothing can be signed in with it.
 */
function adoptAdminRow(email: string, displayName: string) {
  const existing = adminRow()
  const now = new Date().toISOString()
  const name = displayName.trim().slice(0, 48) || 'Administrator'

  if (existing) {
    getDatabase()
      .prepare('UPDATE admin_users SET email = ?, display_name = ?, last_sign_in_at = ? WHERE id = ?')
      .run(email, name, now, existing.id)
    return { ...existing, email, display_name: name, last_sign_in_at: now }
  }

  const { hash, salt } = hashPassword(randomBytes(32).toString('base64url'))
  const id = randomUUID()
  getDatabase()
    .prepare(
      `INSERT INTO admin_users
         (id, email, display_name, password_hash, password_salt, created_at, last_sign_in_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, email, name, hash, salt, now, now)
  return {
    id,
    email,
    display_name: name,
    password_hash: hash,
    password_salt: salt,
    created_at: now,
    last_sign_in_at: now
  }
}

/**
 * Lets the ordinary Sign in screen recognise the administrator.
 *
 * There is one sign-in screen in the product, and it is the one people find, so
 * typing the administrator's email and password there opens the administration
 * panel rather than answering "that password is incorrect". The two identities
 * stay separate underneath: this creates an admin session and no user session.
 *
 * A different email returns null without touching the throttle, so an ordinary
 * user mistyping their own password can never lock the administrator out. An
 * attempt on the administrator's own address is throttled exactly like the gate.
 */
export async function signInAdminFromLogin(input: {
  identifier?: string
  password?: string
} | null): Promise<AdminAccount | null> {
  const identifier = normalizeEmail(input?.identifier ?? '')
  if (!identifier) return null

  /*
   * Only a plausible administrator address is even tried, so an ordinary person
   * typing their own wrong password can never be throttled by this path, and
   * nothing about which addresses exist is revealed by it.
   */
  let reserved = reservedAdminEmail()
  if (!reserved) {
    await refreshReservedAdmin()
    reserved = reservedAdminEmail()
  }
  if (!reserved || identifier !== reserved) return null

  try {
    return await adminSignIn({ email: identifier, password: input?.password ?? '' })
  } catch {
    return null
  }
}

export function adminSignOut(): void {
  const row = adminRow()
  const session = readSession()
  clearState(SESSION_KEY)
  if (row && session?.adminId === row.id) {
    audit('sign_out', 'Administrator signed out.', row.id)
  }
}

/** Every admin data call resolves its caller here, never from the renderer. */
export function requireAdmin(): AdminAccount {
  const row = adminRow()
  const session = readSession()
  if (!row || session?.adminId !== row.id) throw errors.adminRequired()
  return toAccount(row)
}

/* ------------------------------------------------------------------ */
/* Installation overview                                               */
/* ------------------------------------------------------------------ */

function count(table: string): number {
  const row = getDatabase().prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as {
    total: number
  }
  return Number(row.total)
}

function listAccounts(): AdminAccountRow[] {
  const rows = getDatabase()
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.email, u.created_at, u.suspended_at,
              (SELECT COUNT(*) FROM projects p WHERE p.owner_id = u.id) AS owned_projects,
              (SELECT COUNT(*) FROM project_members m WHERE m.user_id = u.id) AS memberships,
              (SELECT COUNT(*) FROM documents d WHERE d.created_by = u.id) AS document_count,
              (SELECT COUNT(*) FROM presentations pr WHERE pr.created_by = u.id) AS presentation_count
         FROM users u
        WHERE u.remote_profile IS NULL
        ORDER BY u.created_at DESC
        LIMIT 200`
    )
    .all() as Array<{
    id: string
    username: string
    display_name: string
    email: string
    created_at: string
    suspended_at: string | null
    owned_projects: number
    memberships: number
    document_count: number
    presentation_count: number
  }>

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    createdAt: row.created_at,
    suspendedAt: row.suspended_at,
    ownedProjects: Number(row.owned_projects),
    memberships: Number(row.memberships),
    documentCount: Number(row.document_count),
    presentationCount: Number(row.presentation_count)
  }))
}

function listProjects(): AdminProjectRow[] {
  const rows = getDatabase()
    .prepare(
      `SELECT p.id, p.name, p.description, p.owner_id, p.created_at, p.updated_at,
              u.display_name AS owner_name, u.email AS owner_email,
              (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id) AS member_count,
              (SELECT COUNT(*) FROM documents d WHERE d.project_id = p.id) AS document_count,
              (SELECT COUNT(*) FROM presentations pr WHERE pr.project_id = p.id) AS presentation_count
         FROM projects p
         JOIN users u ON u.id = p.owner_id
        ORDER BY p.updated_at DESC
        LIMIT 200`
    )
    .all() as Array<{
    id: string
    name: string
    description: string
    owner_id: string
    created_at: string
    updated_at: string
    owner_name: string
    owner_email: string
    member_count: number
    document_count: number
    presentation_count: number
  }>

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    memberCount: Number(row.member_count),
    documentCount: Number(row.document_count),
    presentationCount: Number(row.presentation_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))
}

function listContent(): AdminContentRow[] {
  const rows = getDatabase()
    .prepare(
      `SELECT d.id, 'document' AS kind, d.title, d.project_id, p.name AS project_name,
              u.display_name AS author_name, d.version AS units, d.updated_at
         FROM documents d
         JOIN projects p ON p.id = d.project_id
         JOIN users u ON u.id = d.created_by
        UNION ALL
       SELECT pr.id, 'presentation', pr.title, pr.project_id, p.name,
              u.display_name,
              (SELECT COUNT(*) FROM presentation_slides s WHERE s.presentation_id = pr.id),
              pr.updated_at
         FROM presentations pr
         JOIN projects p ON p.id = pr.project_id
         JOIN users u ON u.id = pr.created_by
        ORDER BY 8 DESC
        LIMIT 200`
    )
    .all() as Array<{
    id: string
    kind: AdminContentRow['kind']
    title: string
    project_id: string
    project_name: string
    author_name: string
    units: number
    updated_at: string
  }>

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    projectId: row.project_id,
    projectName: row.project_name,
    authorName: row.author_name,
    units: Number(row.units),
    updatedAt: row.updated_at
  }))
}

function listAudit(): AdminAuditEntry[] {
  const rows = getDatabase()
    .prepare(
      `SELECT a.id, a.action, a.detail, a.created_at, u.email AS admin_email
         FROM admin_audit a
         LEFT JOIN admin_users u ON u.id = a.admin_id
        ORDER BY a.created_at DESC
        LIMIT 100`
    )
    .all() as Array<{
    id: string
    action: AdminAuditAction
    detail: string
    created_at: string
    admin_email: string | null
  }>

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    detail: row.detail,
    adminEmail: row.admin_email,
    createdAt: row.created_at
  }))
}

function systemInfo(): AdminSystemInfo {
  let databaseBytes = 0
  try {
    databaseBytes = statSync(join(app.getPath('userData'), 'indra-hub.db')).size
  } catch {
    databaseBytes = 0
  }

  const version = getDatabase().prepare('PRAGMA user_version').get() as
    | { user_version?: number }
    | undefined

  return {
    appVersion: runningVersion(),
    electron: process.versions.electron ?? '—',
    chrome: process.versions.chrome ?? '—',
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    databaseBytes,
    schemaVersion: Number(version?.user_version ?? 0),
    startedAt: STARTED_AT
  }
}

export function adminOverview(): AdminOverview {
  const admin = requireAdmin()
  return {
    counts: {
      accounts: count('users'),
      projects: count('projects'),
      memberships: count('project_members'),
      documents: count('documents'),
      presentations: count('presentations'),
      slides: count('presentation_slides')
    },
    admin,
    sessionUserId: activeSessionUserId(),
    accounts: listAccounts(),
    projects: listProjects(),
    content: listContent(),
    activationKeys: listActivationKeys(),
    audit: listAudit(),
    settings: readSettings(),
    appearance: readLoginAppearance(),
    system: systemInfo()
  }
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

function requireUserRow(userId: string): UserRow {
  const row = getDatabase()
    .prepare(
      'SELECT id, username, display_name, email, created_at, suspended_at FROM users WHERE id = ?'
    )
    .get(userId) as UserRow | undefined
  if (!row) throw errors.notFound('That account no longer exists.')
  return row
}


/*
 * The server half of an account action.
 *
 * Every one of these is a server function that refuses unless the caller is the
 * administrator, and none of them can be faked from here. Running it first means
 * the local row is only touched once the account has actually changed on the
 * server — the reverse order is what made a "deleted" account sign straight back
 * in.
 */
async function adminAccountRpc(
  adminId: string,
  fn: 'indra_admin_delete_account' | 'indra_admin_set_suspended' | 'indra_admin_reset_password',
  body: Record<string, unknown>
): Promise<void> {
  try {
    await adminCloudRequest(adminId, `/rest/v1/rpc/${fn}`, { method: 'POST', body })
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (/not_an_administrator/.test(text)) {
      throw errors.validation(
        'The server does not recognise this account as the administrator, so nothing was changed.',
        'code'
      )
    }
    if (/owns_projects/.test(text)) {
      throw errors.conflict(
        'This account still owns projects on the server. Transfer or delete those first.'
      )
    }
    if (/cannot_delete_yourself/.test(text)) {
      throw errors.validation('You cannot delete the account you are signed in as.', 'code')
    }
    if (/cannot_suspend_yourself/.test(text)) {
      throw errors.validation('You cannot suspend the account you are signed in as.', 'code')
    }
    throw new Error(`The server refused: ${text}`)
  }
}

/** The Supabase identity behind a local row, if this account has one. */
function authUidOf(userId: string): string | null {
  const row = getDatabase()
    .prepare('SELECT auth_user_id FROM users WHERE id = ?')
    .get(userId) as { auth_user_id: string | null } | undefined
  const uid = row?.auth_user_id ?? null
  return uid && uid.length > 0 ? uid : null
}

export async function setAccountSuspended(userId: string, suspended: boolean): Promise<void> {
  const admin = requireAdmin()
  const user = requireUserRow(userId)
  const now = new Date().toISOString()

  /*
   * The server decides first. Suspending is a ban in Supabase Auth, so the
   * person cannot sign in on any PC — including one that has never been online
   * and has never heard of this console.
   */
  const uid = authUidOf(userId)
  if (uid) {
    await adminAccountRpc(admin.id, 'indra_admin_set_suspended', {
      p_auth_uid: uid,
      p_suspended: suspended
    })
  }

  getDatabase()
    .prepare('UPDATE users SET suspended_at = ? WHERE id = ?')
    .run(suspended ? now : null, userId)

  // Suspension ends their session now, rather than on their next sign-in.
  if (suspended && activeSessionUserId() === userId) signOut()

  audit(
    suspended ? 'account_suspended' : 'account_restored',
    `${user.email} ${suspended ? 'suspended' : 'restored'}.`,
    admin.id
  )
}

export async function resetAccountPassword(userId: string, password: string): Promise<void> {
  const admin = requireAdmin()
  const user = requireUserRow(userId)
  const next = password ?? ''
  if (next.length < 8 || next.length > 200) {
    throw errors.validation('Use 8–200 characters for the new password.', 'password')
  }

  /*
   * The password the person signs in with is the server's. Changing only the
   * local hash reset a password that was never used to sign in.
   */
  const uid = authUidOf(userId)
  if (uid) {
    await adminAccountRpc(admin.id, 'indra_admin_reset_password', {
      p_auth_uid: uid,
      p_password: next
    })
  }

  const { hash, salt } = hashPassword(next)
  // A reset also clears any lockout, so a locked-out person can get back in.
  getDatabase()
    .prepare(
      `UPDATE users
          SET password_hash = ?, password_salt = ?, password_changed_at = ?,
              failed_login_count = 0, locked_until = NULL
        WHERE id = ?`
    )
    .run(hash, salt, new Date().toISOString(), userId)

  if (activeSessionUserId() === userId) signOut()

  audit('password_reset', `Password reset for ${user.email}.`, admin.id)
}

export async function deleteAccount(userId: string): Promise<void> {
  const admin = requireAdmin()
  const user = requireUserRow(userId)
  const db = getDatabase()

  const owned = (
    db.prepare('SELECT COUNT(*) AS total FROM projects WHERE owner_id = ?').get(userId) as {
      total: number
    }
  ).total
  const documents = (
    db.prepare('SELECT COUNT(*) AS total FROM documents WHERE created_by = ?').get(userId) as {
      total: number
    }
  ).total
  const presentations = (
    db.prepare('SELECT COUNT(*) AS total FROM presentations WHERE created_by = ?').get(userId) as {
      total: number
    }
  ).total

  if (Number(owned) + Number(documents) + Number(presentations) > 0) {
    throw errors.conflict(
      'This account still owns projects or created documents and presentations. Transfer or delete those first.'
    )
  }

  /*
   * The server goes first, and its refusal is the answer. An account with no
   * Supabase identity (one created before accounts moved to the server) has
   * nothing up there, so the local delete is the whole delete.
   */
  const uid = authUidOf(userId)
  if (uid) {
    await adminAccountRpc(admin.id, 'indra_admin_delete_account', { p_auth_uid: uid })
  }

  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM project_members WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM users WHERE id = ?').run(userId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  if (activeSessionUserId() === userId) signOut()
  audit('account_deleted', `Account ${user.email} deleted.`, admin.id)
}

export function signOutAccount(userId: string): { cleared: boolean } {
  const admin = requireAdmin()
  const user = requireUserRow(userId)
  const cleared = activeSessionUserId() === userId
  if (cleared) {
    signOut()
    audit('account_signed_out', `Active session ended for ${user.email}.`, admin.id)
  }
  return { cleared }
}

export function signOutAllAccounts(): { cleared: boolean } {
  const admin = requireAdmin()
  const cleared = activeSessionUserId() !== null
  signOut()
  if (cleared) audit('sessions_cleared', 'All ordinary sessions ended.', admin.id)
  return { cleared }
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

function requireProjectRow(projectId: string): { id: string; name: string; owner_id: string } {
  const row = getDatabase()
    .prepare('SELECT id, name, owner_id FROM projects WHERE id = ?')
    .get(projectId) as { id: string; name: string; owner_id: string } | undefined
  if (!row) throw errors.notFound('That project no longer exists.')
  return row
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  const admin = requireAdmin()
  const project = requireProjectRow(projectId)
  const { name: clean } = validateProjectInput({ name })

  // The cloud name is what other machines read; a rename that stops here is
  // undone by the next pull.
  await adminRenameCloudProject(admin.id, projectId, clean, null).catch(() => false)

  getDatabase()
    .prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
    .run(clean, new Date().toISOString(), projectId)
  audit('project_renamed', `Project "${project.name}" renamed to "${clean}".`, admin.id)
}

export async function transferProject(projectId: string, ownerId: string): Promise<void> {
  const admin = requireAdmin()
  const project = requireProjectRow(projectId)
  const target = requireUserRow(ownerId)

  if (project.owner_id === ownerId) {
    throw errors.validation('That account already owns this project.', 'ownerId')
  }
  if (target.suspended_at) {
    throw errors.validation('Restore the account before making it a project owner.', 'ownerId')
  }

  /*
   * The cloud row is keyed on the profile id, not the local one, so the transfer
   * is done there first and with that id. An account with no cloud profile has
   * nothing up there to own a project, and the server says so.
   */
  const profile = getDatabase()
    .prepare('SELECT cloud_profile_id FROM users WHERE id = ?')
    .get(ownerId) as { cloud_profile_id: string | null } | undefined
  if (profile?.cloud_profile_id) {
    await adminTransferCloudProject(admin.id, projectId, profile.cloud_profile_id)
  }

  const db = getDatabase()
  db.exec('BEGIN')
  try {
    // The owner never keeps a member row — the trigger forbids that state.
    db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(
      projectId,
      ownerId
    )
    db.prepare('UPDATE projects SET owner_id = ?, updated_at = ? WHERE id = ?').run(
      ownerId,
      new Date().toISOString(),
      projectId
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  audit(
    'project_transferred',
    `Project "${project.name}" transferred to ${target.email}.`,
    admin.id
  )
}

export async function deleteProject(projectId: string): Promise<void> {
  const admin = requireAdmin()
  const project = requireProjectRow(projectId)

  /*
   * The cloud copy goes first. Deleting only here looked finished until the next
   * sync pulled the project back — with its documents, decks and members.
   */
  await adminDeleteCloudProject(admin.id, projectId)

  getDatabase().prepare('DELETE FROM projects WHERE id = ?').run(projectId)
  audit('project_deleted', `Project "${project.name}" deleted with all its content.`, admin.id)
}

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

export async function deleteDocument(documentId: string): Promise<void> {
  const admin = requireAdmin()
  const row = getDatabase()
    .prepare(
      `SELECT d.title, p.name AS project_name
         FROM documents d JOIN projects p ON p.id = d.project_id
        WHERE d.id = ?`
    )
    .get(documentId) as { title: string; project_name: string } | undefined
  if (!row) throw errors.notFound('That document no longer exists.')

  await adminDeleteCloudDocument(admin.id, documentId)

  const db = getDatabase()
  db.exec('BEGIN')
  try {
    // Generated decks keep their slides but lose the source link.
    db.prepare('UPDATE presentations SET source_document_id = NULL WHERE source_document_id = ?').run(
      documentId
    )
    db.prepare('DELETE FROM documents WHERE id = ?').run(documentId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  audit('document_deleted', `Document "${row.title}" deleted from "${row.project_name}".`, admin.id)
}

export async function deletePresentation(presentationId: string): Promise<void> {
  const admin = requireAdmin()
  const row = getDatabase()
    .prepare(
      `SELECT pr.title, p.name AS project_name
         FROM presentations pr JOIN projects p ON p.id = pr.project_id
        WHERE pr.id = ?`
    )
    .get(presentationId) as { title: string; project_name: string } | undefined
  if (!row) throw errors.notFound('That presentation no longer exists.')

  await adminDeleteCloudPresentation(admin.id, presentationId)

  getDatabase().prepare('DELETE FROM presentations WHERE id = ?').run(presentationId)
  audit(
    'presentation_deleted',
    `Presentation "${row.title}" deleted from "${row.project_name}".`,
    admin.id
  )
}

/* ------------------------------------------------------------------ */
/* App-wide settings                                                   */
/* ------------------------------------------------------------------ */

export function updateSettings(input: AdminSettings): AdminSettings {
  const admin = requireAdmin()

  if (
    typeof input?.allowRegistration !== 'boolean' ||
    typeof input?.maintenanceMode !== 'boolean' ||
    typeof input?.requireActivationKey !== 'boolean'
  ) {
    throw errors.validation('Every switch must be on or off.')
  }

  const message = (input.maintenanceMessage ?? '').trim()
  if (message.length > 280) {
    throw errors.validation('Keep the maintenance message under 280 characters.', 'maintenanceMessage')
  }
  if (input.maintenanceMode && !message) {
    throw errors.validation('Write a message to show during maintenance.', 'maintenanceMessage')
  }

  const next: AdminSettings = {
    allowRegistration: input.allowRegistration,
    maintenanceMode: input.maintenanceMode,
    maintenanceMessage: message,
    requireActivationKey: input.requireActivationKey
  }

  const saved = writeSettings(next)
  audit(
    'settings_updated',
    `Registration ${saved.allowRegistration ? 'open' : 'closed'}; maintenance ${
      saved.maintenanceMode ? 'on' : 'off'
    }; activation keys ${saved.requireActivationKey ? 'required' : 'optional'}.`,
    admin.id
  )
  return saved
}

/* ------------------------------------------------------------------ */
/* Activation keys                                                     */
/* ------------------------------------------------------------------ */

export async function syncActivationKeys(): Promise<ActivationKeyRow[]> {
  requireAdmin()
  const admin = requireAdmin()
  const rows = await adminCloudRequest<ServerKeyRow[]>(admin.id, '/rest/v1/rpc/indra_admin_keys', {
    method: 'POST',
    body: {}
  })
  mirrorServerKeys(rows ?? [])
  return listActivationKeys()
}

export async function createKeys(input: CreateActivationKeyInput): Promise<CreatedActivationKey[]> {
  const admin = requireAdmin()
  requireServerKeys()

  const count = Math.max(1, Math.min(25, Number(input?.count ?? 1) || 1))
  const label = String(input?.label ?? '').trim().slice(0, 60)
  const days = input?.expiresInDays
  const expiresAt =
    days === null || days === undefined
      ? null
      : new Date(Date.now() + Math.max(1, Math.min(365, Number(days))) * 86_400_000).toISOString()

  let created: { id: string; code: string; masked_code: string; label: string; expires_at: string | null }[]
  try {
    created = await adminCloudRequest(
      admin.id,
      '/rest/v1/rpc/indra_admin_create_keys',
      { method: 'POST', body: { p_count: count, p_label: label, p_expires_at: expiresAt } }
    )
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (/not_an_administrator/.test(text)) {
      throw errors.validation(
        'The server does not recognise this account as the administrator, so no key was created.',
        'code'
      )
    }
    throw new Error(`The server refused to create a key: ${text}`)
  }

  await syncActivationKeys().catch(() => undefined)
  audit(
    'keys_created',
    `${created.length} activation key${created.length === 1 ? '' : 's'} generated${
      label ? ` for “${label}”` : ''
    } on the server.`,
    admin.id
  )

  return created.map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    expiresAt: row.expires_at
  }))
}

function keyLabel(id: string): string {
  const row = getDatabase()
    .prepare('SELECT masked_code FROM activation_keys WHERE id = ?')
    .get(id) as { masked_code: string } | undefined
  return row?.masked_code ?? id
}

export async function revokeKey(id: string): Promise<void> {
  const admin = requireAdmin()
  requireServerKeys()
  const masked = keyLabel(id)
  await adminCloudRequest(admin.id, '/rest/v1/rpc/indra_admin_revoke_key', {
    method: 'POST',
    body: { p_id: id }
  })
  await syncActivationKeys().catch(() => undefined)
  audit('key_revoked', `Activation key ${masked} revoked on the server.`, admin.id)
}

export async function removeKey(id: string): Promise<void> {
  const admin = requireAdmin()
  requireServerKeys()
  const masked = keyLabel(id)
  await adminCloudRequest(admin.id, '/rest/v1/rpc/indra_admin_delete_key', {
    method: 'POST',
    body: { p_id: id }
  })
  await syncActivationKeys().catch(() => undefined)
  audit('key_deleted', `Activation key ${masked} deleted from the server.`, admin.id)
}

/* ------------------------------------------------------------------ */
/* Administrator credential                                            */
/* ------------------------------------------------------------------ */

/**
 * Changes the administrator's own email and name.
 *
 * The email is the sign-in identity, so this asks for the current password:
 * an unattended, signed-in window must not be enough to move the account to an
 * address someone else controls.
 */
export function updateAdminIdentity(input: AdminIdentityInput): AdminAccount {
  const admin = requireAdmin()
  const row = adminRow()
  if (!row) throw errors.adminRequired()

  if (!verifyPassword(input?.currentPassword ?? '', { hash: row.password_hash, salt: row.password_salt })) {
    throw errors.validation('Current password is incorrect.', 'currentPassword')
  }

  const email = normalizeEmail(input?.email ?? '')
  const displayName = (input?.displayName ?? '').trim().replace(/\s+/g, ' ')

  if (!EMAIL_PATTERN.test(email)) {
    throw errors.validation('Enter a valid email address.', 'email')
  }
  if (!email.endsWith('@gmail.com')) {
    throw errors.validation('Administrator access uses a Gmail address.', 'email')
  }
  if (displayName.length < 2 || displayName.length > 48) {
    throw errors.validation('Name must be 2–48 characters.', 'displayName')
  }

  if (email === row.email && displayName === row.display_name) return toAccount(row)

  getDatabase()
    .prepare('UPDATE admin_users SET email = ?, display_name = ? WHERE id = ?')
    .run(email, displayName, row.id)

  audit('identity_changed', `Administrator identity changed to ${email}.`, admin.id)

  const updated = adminRow()
  if (!updated) throw new Error('administrator vanished after update')
  return toAccount(updated)
}

export function changeAdminPassword(currentPassword: string, newPassword: string): void {
  const admin = requireAdmin()
  const row = adminRow()
  if (!row) throw errors.adminRequired()

  if (!verifyPassword(currentPassword ?? '', { hash: row.password_hash, salt: row.password_salt })) {
    throw errors.validation('Current password is incorrect.', 'currentPassword')
  }
  if ((newPassword ?? '').length < 10 || (newPassword ?? '').length > 200) {
    throw errors.validation('Use at least 10 characters for the new password.', 'newPassword')
  }
  if (newPassword === currentPassword) {
    throw errors.validation('Choose a password you have not used here.', 'newPassword')
  }

  const { hash, salt } = hashPassword(newPassword)
  getDatabase()
    .prepare('UPDATE admin_users SET password_hash = ?, password_salt = ? WHERE id = ?')
    .run(hash, salt, row.id)

  audit('password_changed', 'Administrator password changed.', admin.id)
}

/* ------------------------------------------------------------------ */
/* Offline recovery                                                    */
/* ------------------------------------------------------------------ */

/**
 * Removes the administrator identity from this installation.
 *
 * There is exactly one administrator and no seeded password, which is the
 * right shape — but it also means a forgotten password would otherwise lock
 * the installation forever. This runs only from the command line
 * (`INDRA HUB --reset-admin`), never from the interface: recovering access
 * requires control of the machine, which is the same bar as reading the
 * database file directly. Projects, documents, accounts and activation keys
 * are untouched; only the administrator has to be set up again.
 */
export function resetAdminIdentity(): { reset: boolean } {
  const row = adminRow()
  if (!row) return { reset: false }

  const db = getDatabase()
  clearState(SESSION_KEY)
  // The audit trail stays; its author becomes unknown, as it was before.
  db.prepare('UPDATE admin_audit SET admin_id = NULL WHERE admin_id = ?').run(row.id)
  db.prepare('DELETE FROM admin_users WHERE id = ?').run(row.id)
  // Do not silently recreate the shipped account: after a deliberate reset the
  // operator sets the administrator they want, from the administration area.
  writeState(SEED_SUPPRESSED_KEY, true)
  return { reset: true }
}

/* ------------------------------------------------------------------ */
/* Appearance                                                          */
/* ------------------------------------------------------------------ */

/*
 * Only the administrator can change what the signed-out screens look like,
 * and every change is written to the activity log — like the other switches,
 * the renderer is never trusted to apply it on its own.
 */

export function installAppearanceVideo(sourcePath: string, originalName: string): LoginAppearance {
  const admin = requireAdmin()
  const next = installLoginBackground(sourcePath, originalName)
  audit(
    'appearance_updated',
    `Sign-in background video set to ${next.background?.originalName ?? 'a new file'} (${next.background?.mime ?? 'video'}).`,
    admin.id
  )
  return next
}

/**
 * Recording a background video that was refused, or never chosen.
 *
 * Uploading a file and having nothing happen is the worst kind of failure: no
 * error, no change, and no way to tell whether the app disagreed with the file
 * or the dialog simply closed. Every outcome is written to the audit trail now,
 * so the Activity screen answers the question instead of the guesswork.
 */
export function noteAppearanceOutcome(message: string): void {
  try {
    audit('appearance_updated', message, adminRow()?.id ?? 'appearance')
  } catch {
    // Logging must never be the reason a dialog fails.
  }
}

export function clearAppearanceVideo(): LoginAppearance {
  const admin = requireAdmin()
  const next = removeLoginBackground()
  audit('appearance_removed', 'Sign-in background video removed.', admin.id)
  return next
}

export function updateAppearanceTreatment(input: AppearanceTreatment): LoginAppearance {
  const admin = requireAdmin()
  if (!Number.isFinite(input?.blur) || !Number.isFinite(input?.dim)) {
    throw errors.validation('Blur and dim must be numbers.')
  }
  const next = writeTreatment(input)
  audit('appearance_updated', `Background treatment: ${next.blur}px blur, ${next.dim}% dim.`, admin.id)
  return next
}
