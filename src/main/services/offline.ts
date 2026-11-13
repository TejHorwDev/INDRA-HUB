import { randomBytes, randomUUID } from 'node:crypto'
import type { OfflineWorkSummary, SessionUser } from '@shared/types'
import { OFFLINE_DISPLAY_NAME, OFFLINE_EMAIL, OFFLINE_USERNAME } from '@shared/offline'
import { getDatabase } from '../db/database'
import { errors } from '../lib/errors'
import { hashPassword } from '../lib/password'
import { findUserById } from './users'

/*
 * Offline is a workspace, not an account.
 *
 * The rule the app now keeps: no credential is accepted while this machine has
 * no route out. Signing in is an online act — it exists to reach a cloud copy,
 * a team, an identity somewhere else. With no connection the honest thing is to
 * open the writing tools and say so, not to ask for a password and then check
 * it against a local hash that proves nothing about the outside world.
 *
 * Work made offline has to belong to something, because projects have an owner
 * and documents have an author as foreign keys. So one local profile owns it:
 *
 *   - its password is 32 random bytes that are hashed and then dropped, so
 *     there is no credential to guess, and sign-in as this name is refused
 *     explicitly as well as practically;
 *   - it never appears in a member list, a search, or a roster;
 *   - when the person signs in afterwards, their account can adopt the work in
 *     one action (claimOfflineWork), so offline work is never orphaned on the
 *     disk it was written on.
 */

const EMPTY: OfflineWorkSummary = { projects: 0, documents: 0, presentations: 0 }

export function offlineUserId(): string | null {
  const row = getDatabase()
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(OFFLINE_USERNAME) as { id: string } | undefined
  return row?.id ?? null
}

export function isOfflineUserId(id: string): boolean {
  return offlineUserId() === id
}

/**
 * The profile that owns offline work, created on first use.
 *
 * Its password cannot be known by anybody: it is generated here, hashed, and
 * discarded in the same statement. This row authenticates nobody — it exists so
 * the foreign keys are honest.
 */
export function ensureOfflineProfile(): SessionUser {
  const existing = offlineUserId()
  if (existing) {
    const user = findUserById(existing)
    if (user) return user
  }

  const { hash, salt } = hashPassword(randomBytes(32).toString('base64url'))
  const id = randomUUID()
  const now = new Date().toISOString()

  getDatabase()
    .prepare(
      `INSERT INTO users
         (id, username, display_name, email, password_hash, password_salt,
          created_at, password_changed_at, last_sign_in_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, OFFLINE_USERNAME, OFFLINE_DISPLAY_NAME, OFFLINE_EMAIL, hash, salt, now, now, now)

  const user = findUserById(id)
  if (!user) throw new Error('offline profile vanished after insert')
  return user
}

/** How much work is sitting in the offline workspace right now. */
export function offlineWork(): OfflineWorkSummary {
  const id = offlineUserId()
  if (!id) return { ...EMPTY }

  const row = getDatabase()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM projects WHERE owner_id = ?1) AS projects,
         (SELECT COUNT(*) FROM documents d JOIN projects p ON p.id = d.project_id
           WHERE p.owner_id = ?1) AS documents,
         (SELECT COUNT(*) FROM presentations pr JOIN projects p ON p.id = pr.project_id
           WHERE p.owner_id = ?1) AS presentations`
    )
    .get(id) as { projects: number; documents: number; presentations: number } | undefined

  return {
    projects: Number(row?.projects ?? 0),
    documents: Number(row?.documents ?? 0),
    presentations: Number(row?.presentations ?? 0)
  }
}

/**
 * Moves every project written offline into the signed-in account.
 *
 * Ownership moves; nothing is copied and nothing is deleted, so a document keeps
 * its history, its versions and its ids. The offline profile stays behind,
 * empty and ready for the next time the machine has no route out.
 */
export function claimOfflineWork(viewer: SessionUser): OfflineWorkSummary {
  if (viewer.mode === 'offline') {
    throw errors.forbidden('Sign in to your own account to bring offline work into it.')
  }

  const id = offlineUserId()
  if (!id) return { ...EMPTY }

  const db = getDatabase()
  db.exec('BEGIN')
  try {
    // Members added while offline would keep a stale roster entry; there is
    // nobody to add offline, so the ownership move is the whole story.
    db.prepare('UPDATE projects SET owner_id = ?, updated_at = ? WHERE owner_id = ?').run(
      viewer.id,
      new Date().toISOString(),
      id
    )
    // Documents and decks authored offline are re-attributed to the account that
    // now owns them, so nothing in the workspace shows a phantom author.
    db.prepare('UPDATE documents SET created_by = ?, updated_by = ? WHERE created_by = ?').run(
      viewer.id,
      viewer.id,
      id
    )
    db.prepare('UPDATE presentations SET created_by = ? WHERE created_by = ?').run(viewer.id, id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return offlineWork()
}
