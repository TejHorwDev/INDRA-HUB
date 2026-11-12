import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const KEY_LENGTH = 64

export interface PasswordRecord {
  hash: string
  salt: string
}

export function hashPassword(password: string): PasswordRecord {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex')
  return { hash, salt }
}

/** Constant-time comparison so failures can't be timed. */
export function verifyPassword(password: string, record: PasswordRecord): boolean {
  const candidate = scryptSync(password, record.salt, KEY_LENGTH)
  const expected = Buffer.from(record.hash, 'hex')
  if (candidate.length !== expected.length) return false
  return timingSafeEqual(candidate, expected)
}
