import { createHash, randomInt, randomUUID } from 'node:crypto'
import type {
  ActivationKeyRow,
  ActivationKeyStatus,
  CreateActivationKeyInput,
  CreatedActivationKey
} from '@shared/types'
import { getDatabase } from '../db/database'
import { errors } from '../lib/errors'

/*
 * Local activation keys ("keyauth").
 *
 * Only a SHA-256 digest of each key is stored — the plaintext exists once, in
 * the creation response. Keys are short-lived authorisation tokens for account
 * creation, not passwords, so a fast digest is appropriate; they are also
 * single-use, revocable and optionally expiring.
 *
 * When the app moves online, this module is the single place a hosted
 * licensing provider (for example KeyAuth) would plug in: registration calls
 * `consumeActivationKey`, and everything else stays the same.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const GROUPS = 3
const GROUP_LENGTH = 4
const MAX_KEYS = 25

interface KeyRow {
  id: string
  code_hash: string
  masked_code: string
  label: string
  created_at: string
  expires_at: string | null
  used_at: string | null
  used_by_email: string | null
  revoked_at: string | null
}

export function normalizeActivationCode(value: string): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function digest(value: string): string {
  return createHash('sha256').update(normalizeActivationCode(value)).digest('hex')
}

function randomGroup(): string {
  let out = ''
  for (let index = 0; index < GROUP_LENGTH; index += 1) {
    out += ALPHABET[randomInt(0, ALPHABET.length)]
  }
  return out
}

function generateCode(): string {
  const groups = Array.from({ length: GROUPS }, randomGroup)
  return `INDRA-${groups.join('-')}`
}

function statusOf(row: KeyRow, now: number): ActivationKeyStatus {
  if (row.revoked_at) return 'revoked'
  if (row.used_at) return 'used'
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return 'expired'
  return 'unused'
}

export function listActivationKeys(): ActivationKeyRow[] {
  const now = Date.now()
  const rows = getDatabase()
    .prepare(
      `SELECT k.id, k.code_hash, k.masked_code, k.label, k.created_at, k.expires_at,
              k.used_at, k.revoked_at, u.email AS used_by_email
         FROM activation_keys k
         LEFT JOIN users u ON u.id = k.used_by_user_id
        ORDER BY k.created_at DESC
        LIMIT 300`
    )
    .all() as unknown as KeyRow[]

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    maskedCode: row.masked_code,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    usedByEmail: row.used_by_email,
    revokedAt: row.revoked_at,
    status: statusOf(row, now)
  }))
}

export function createActivationKeys(
  adminId: string,
  input: CreateActivationKeyInput
): CreatedActivationKey[] {
  const count = Math.floor(Number(input?.count ?? 1))
  if (!Number.isFinite(count) || count < 1 || count > MAX_KEYS) {
    throw errors.validation(`Generate between 1 and ${MAX_KEYS} keys at a time.`, 'count')
  }

  const label = (input?.label ?? '').trim().slice(0, 60)
  const days = input?.expiresInDays == null ? null : Math.floor(Number(input.expiresInDays))
  if (days !== null && (!Number.isFinite(days) || days < 1 || days > 3650)) {
    throw errors.validation('Expiry must be between 1 and 3650 days, or empty.', 'expiresInDays')
  }

  const now = new Date()
  const createdAt = now.toISOString()
  const expiresAt = days === null ? null : new Date(now.getTime() + days * 86_400_000).toISOString()
  const db = getDatabase()
  const insert = db.prepare(
    `INSERT INTO activation_keys
       (id, code_hash, masked_code, label, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )

  const created: CreatedActivationKey[] = []
  db.exec('BEGIN')
  try {
    for (let index = 0; index < count; index += 1) {
      let code = generateCode()
      let hash = digest(code)
      // A collision is vanishingly unlikely, but a duplicate would be rejected
      // by the unique index — regenerate instead of failing the batch.
      while (db.prepare('SELECT 1 FROM activation_keys WHERE code_hash = ?').get(hash)) {
        code = generateCode()
        hash = digest(code)
      }

      const id = randomUUID()
      const masked = `INDRA-****-****-${normalizeActivationCode(code).slice(-GROUP_LENGTH)}`
      insert.run(id, hash, masked, label, adminId, createdAt, expiresAt)
      created.push({ id, code, label, expiresAt })
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return created
}

export function revokeActivationKey(id: string): void {
  const key = getDatabase()
    .prepare('SELECT id, used_at, revoked_at FROM activation_keys WHERE id = ?')
    .get(id) as { id: string; used_at: string | null; revoked_at: string | null } | undefined
  if (!key) throw errors.notFound('That activation key no longer exists.')
  if (key.used_at) throw errors.conflict('That key has already been used and cannot be revoked.')
  if (key.revoked_at) throw errors.conflict('That key is already revoked.')

  getDatabase()
    .prepare('UPDATE activation_keys SET revoked_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id)
}

export function deleteActivationKey(id: string): void {
  const key = getDatabase()
    .prepare('SELECT id, used_at FROM activation_keys WHERE id = ?')
    .get(id) as { id: string; used_at: string | null } | undefined
  if (!key) throw errors.notFound('That activation key no longer exists.')
  if (key.used_at) {
    throw errors.conflict('Used keys are kept as a record of which account consumed them.')
  }

  getDatabase().prepare('DELETE FROM activation_keys WHERE id = ?').run(id)
}

/**
 * Resolves a usable key without consuming it, so registration can fail early
 * with a clear field error before any account rows are written.
 */
export function findUsableKey(code: string): { id: string } | null {
  const normalized = normalizeActivationCode(code)
  if (normalized.length < 8) return null

  const now = new Date().toISOString()
  const row = getDatabase()
    .prepare(
      `SELECT id FROM activation_keys
        WHERE code_hash = ?
          AND used_at IS NULL
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?)`
    )
    .get(digest(normalized), now) as { id: string } | undefined

  return row ?? null
}

/** Marks the key used inside the caller's database transaction. */
export function consumeActivationKey(keyId: string, userId: string): void {
  const result = getDatabase()
    .prepare(
      `UPDATE activation_keys SET used_at = ?, used_by_user_id = ?
        WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL`
    )
    .run(new Date().toISOString(), userId, keyId)

  if (Number(result.changes) !== 1) {
    throw errors.validation('That activation key was just used. Try another one.', 'activationKey')
  }
}
