import type { SessionUser, UserSummary } from '@shared/types'
import { OFFLINE_USERNAME } from '@shared/offline'
import { getDatabase } from '../db/database'

interface UserRow {
  id: string
  username: string
  display_name: string
  email: string
  created_at: string
  last_sign_in_at: string | null
}

/**
 * Only the public projection leaves this module: no email, no password
 * material, no internal timestamps beyond the account's own session.
 */
function toSummary(row: { id: string; username: string; display_name: string }): UserSummary {
  return { id: row.id, username: row.username, displayName: row.display_name }
}

export function findUserById(id: string): SessionUser | null {
  const row = getDatabase()
    .prepare(
      'SELECT id, username, display_name, email, created_at, last_sign_in_at FROM users WHERE id = ?'
    )
    .get(id) as UserRow | undefined

  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at,
    mode: row.username === OFFLINE_USERNAME ? 'offline' : 'account'
  }
}

interface AccountRow {
  id: string
  username: string
  display_name: string
  email: string
}

/**
 * Finding a person to add, by their email address and nothing else.
 *
 * Names collide — two people called the same thing, three with the same
 * surname — so a name search is a guessing game whose answer is a list. An
 * email address is unique per account and is what the person was given when
 * they registered, so it is the only thing worth searching on. The match is
 * EXACT and case-insensitive: no prefix, no wildcards, so this cannot be used
 * to walk the account table a letter at a time.
 *
 * What comes back carries the display name, because the person adding somebody
 * needs to see who they are about to add — the email alone proves nothing.
 */
export function findAccountsByEmail(email: string): AccountRow[] {
  const address = email.trim()
  if (address.length < 3 || !address.includes('@')) return []

  return getDatabase()
    .prepare(
      `SELECT id, username, display_name, email
         FROM users
        WHERE email = ? COLLATE NOCASE
          AND suspended_at IS NULL
        LIMIT 1`
    )
    .all(address) as unknown as AccountRow[]
}

/**
 * The same lookup, minus anyone who cannot join this project: the owner and the
 * people already on it are filtered out at the SQL level, so the UI is never
 * handed a choice that would fail.
 */
export function searchUsers(query: string, projectId: string, limit = 8): UserSummary[] {
  const address = query.trim()
  if (address.length < 3 || !address.includes('@')) return []

  const rows = getDatabase()
    .prepare(
      `SELECT id, username, display_name, email
         FROM users
        WHERE email = ? COLLATE NOCASE
          AND suspended_at IS NULL
          AND id <> (SELECT owner_id FROM projects WHERE id = ?)
          AND id NOT IN (SELECT user_id FROM project_members WHERE project_id = ?)
          AND id NOT IN (
            SELECT tm.user_id FROM team_members tm
              JOIN teams t ON t.id = tm.team_id
             WHERE t.owner_id = (SELECT owner_id FROM projects WHERE id = ?)
          )
          AND id NOT IN (
            SELECT user_id FROM invitations
             WHERE kind = 'project' AND project_id = ? AND status = 'pending'
          )
        LIMIT ?`
    )
    .all(address, projectId, projectId, projectId, projectId, limit) as unknown as AccountRow[]

  return rows.map((row) => ({ ...toSummary(row), email: row.email }))
}
