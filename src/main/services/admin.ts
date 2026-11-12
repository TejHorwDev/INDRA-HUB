import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
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
  CreateActivationKeyInput,
  CreatedActivationKey
} from '@shared/types'
import { getDatabase } from '../db/database'
import { errors } from '../lib/errors'
import { hashPassword, verifyPassword } from '../lib/password'
import { EMAIL_PATTERN, normalizeEmail, validateProjectInput } from '../lib/validation'
import { activeSessionUserId, signOut } from './auth'
import { readSettings, writeSettings } from './settings'
import {
  createActivationKeys,
  deleteActivationKey,
  listActivationKeys,
  revokeActivationKey
} from './activation'

/*
 * Administration is a separate identity, not a role on a normal account.
 * It has its own table, its own session key and its own short expiry, so a
 * signed-in user has no path to these queries and an admin session never
 * grants access to project data through the ordinary services.
 *
 * Every mutation below re-checks the admin session and writes an audit row.
 */

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

export function adminStatus(): AdminStatus {
  const row = adminRow()
  if (!row) return { configured: false, signedIn: false, admin: null }

  const session = readSession()
  const signedIn = session?.adminId === row.id
  return { configured: true, signedIn, admin: signedIn ? toAccount(row) : null }
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

export function adminSignIn(input: AdminLoginInput): AdminAccount {
  const row = adminRow()
  if (!row) throw errors.adminRequired()

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

  const matches =
    email === row.email &&
    verifyPassword(password, { hash: row.password_hash, salt: row.password_salt })

  if (!matches) {
    const failures = (readState<ThrottleRecord>(THROTTLE_KEY)?.failures ?? 0) + 1
    const locked = failures >= MAX_ATTEMPTS
    writeState(THROTTLE_KEY, {
      failures,
      lockedUntil: locked ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null
    } satisfies ThrottleRecord)
    audit('sign_in_failed', 'Rejected administrator sign-in attempt.', row.id)
    if (locked) {
      throw errors.throttled(
        `Too many attempts. Administrator sign-in is locked for ${LOCK_MINUTES} minutes.`
      )
    }
    throw errors.adminInvalidCredentials()
  }

  clearState(THROTTLE_KEY)
  const now = new Date().toISOString()
  getDatabase().prepare('UPDATE admin_users SET last_sign_in_at = ? WHERE id = ?').run(now, row.id)
  writeSession(row.id)
  audit('sign_in', 'Administrator signed in.', row.id)

  return toAccount({ ...row, last_sign_in_at: now })
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
    appVersion: app.getVersion(),
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

export function setAccountSuspended(userId: string, suspended: boolean): void {
  const admin = requireAdmin()
  const user = requireUserRow(userId)
  const now = new Date().toISOString()

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

export function resetAccountPassword(userId: string, password: string): void {
  const admin = requireAdmin()
  const user = requireUserRow(userId)
  const next = password ?? ''
  if (next.length < 8 || next.length > 200) {
    throw errors.validation('Use 8–200 characters for the new password.', 'password')
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

export function deleteAccount(userId: string): void {
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

export function renameProject(projectId: string, name: string): void {
  const admin = requireAdmin()
  const project = requireProjectRow(projectId)
  const { name: clean } = validateProjectInput({ name })

  getDatabase()
    .prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
    .run(clean, new Date().toISOString(), projectId)
  audit('project_renamed', `Project "${project.name}" renamed to "${clean}".`, admin.id)
}

export function transferProject(projectId: string, ownerId: string): void {
  const admin = requireAdmin()
  const project = requireProjectRow(projectId)
  const target = requireUserRow(ownerId)

  if (project.owner_id === ownerId) {
    throw errors.validation('That account already owns this project.', 'ownerId')
  }
  if (target.suspended_at) {
    throw errors.validation('Restore the account before making it a project owner.', 'ownerId')
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

export function deleteProject(projectId: string): void {
  const admin = requireAdmin()
  const project = requireProjectRow(projectId)

  getDatabase().prepare('DELETE FROM projects WHERE id = ?').run(projectId)
  audit('project_deleted', `Project "${project.name}" deleted with all its content.`, admin.id)
}

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

export function deleteDocument(documentId: string): void {
  const admin = requireAdmin()
  const row = getDatabase()
    .prepare(
      `SELECT d.title, p.name AS project_name
         FROM documents d JOIN projects p ON p.id = d.project_id
        WHERE d.id = ?`
    )
    .get(documentId) as { title: string; project_name: string } | undefined
  if (!row) throw errors.notFound('That document no longer exists.')

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

export function deletePresentation(presentationId: string): void {
  const admin = requireAdmin()
  const row = getDatabase()
    .prepare(
      `SELECT pr.title, p.name AS project_name
         FROM presentations pr JOIN projects p ON p.id = pr.project_id
        WHERE pr.id = ?`
    )
    .get(presentationId) as { title: string; project_name: string } | undefined
  if (!row) throw errors.notFound('That presentation no longer exists.')

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

export function createKeys(input: CreateActivationKeyInput): CreatedActivationKey[] {
  const admin = requireAdmin()
  const created = createActivationKeys(admin.id, input)
  const label = (input?.label ?? '').trim()
  audit(
    'keys_created',
    `${created.length} activation key${created.length === 1 ? '' : 's'} generated${
      label ? ` for “${label}”` : ''
    }.`,
    admin.id
  )
  return created
}

function keyLabel(id: string): string {
  const row = getDatabase()
    .prepare('SELECT masked_code FROM activation_keys WHERE id = ?')
    .get(id) as { masked_code: string } | undefined
  if (!row) throw errors.notFound('That activation key no longer exists.')
  return row.masked_code
}

export function revokeKey(id: string): void {
  const admin = requireAdmin()
  const masked = keyLabel(id)
  revokeActivationKey(id)
  audit('key_revoked', `Activation key ${masked} revoked.`, admin.id)
}

export function removeKey(id: string): void {
  const admin = requireAdmin()
  const masked = keyLabel(id)
  deleteActivationKey(id)
  audit('key_deleted', `Activation key ${masked} deleted.`, admin.id)
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
  return { reset: true }
}
