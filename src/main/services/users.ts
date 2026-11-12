import type { SessionUser, UserSummary } from '@shared/types'
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
    lastSignInAt: row.last_sign_in_at
  }
}

/**
 * Search by username or display name. Results already on the project (and the
 * project owner) are filtered out at the SQL level so the UI cannot offer an
 * invalid choice.
 */
export function searchUsers(query: string, projectId: string, limit = 8): UserSummary[] {
  const like = `%${query.replace(/[%_]/g, '')}%`

  const rows = getDatabase()
    .prepare(
      `SELECT id, username, display_name
         FROM users
        WHERE (username LIKE ? COLLATE NOCASE OR display_name LIKE ? COLLATE NOCASE)
          AND id <> (SELECT owner_id FROM projects WHERE id = ?)
          AND id NOT IN (SELECT user_id FROM project_members WHERE project_id = ?)
        ORDER BY username ASC
        LIMIT ?`
    )
    .all(like, like, projectId, projectId, limit) as Array<{
    id: string
    username: string
    display_name: string
  }>

  return rows.map(toSummary)
}
