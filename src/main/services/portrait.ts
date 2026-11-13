import { randomUUID } from 'node:crypto'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDatabase } from '../db/database'
import { errors } from '../lib/errors'
import { mediaDirectory } from './appearance'
import { signatureOfBytes } from './about'

/**
 * A person's portrait.
 *
 * Three shapes are allowed, and all three are one string on the account:
 *
 *   initials          — the name's first letters, drawn by the renderer
 *   mark:orbit        — one of eight marks drawn by the renderer
 *   photo:<asset id>  — a real image, copied into <userData>/media
 *
 * Keeping a photo as an id rather than a path or base64 means the account row
 * stays small, the bytes have exactly one home, and the same value is what
 * travels to team rows and project members. The renderer never sees a path: it
 * asks for the bytes by id and draws them from a Blob URL, the same contract the
 * sign-in video uses.
 */

const KIND = 'user_portrait'

/** Enough for a phone photo; small enough that a picker mistake is caught. */
export const MAX_PORTRAIT_BYTES = 6 * 1024 * 1024

const PREFIX = 'photo:'
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** Everything an account may call its portrait. */
export const PORTRAIT_PATTERN = new RegExp(`^(initials|mark:[a-z]{3,16}|photo:${ID})$`)

export function portraitMediaId(value: string | null | undefined): string | null {
  if (!value || !value.startsWith(PREFIX)) return null
  const id = value.slice(PREFIX.length)
  return new RegExp(`^${ID}$`).test(id) ? id : null
}

interface MediaRow {
  id: string
  file_name: string
  mime: string
}

function rowFor(id: string): MediaRow | null {
  return (
    (getDatabase()
      .prepare('SELECT id, file_name, mime FROM media_assets WHERE id = ? AND kind = ?')
      .get(id, KIND) as MediaRow | undefined) ?? null
  )
}

/**
 * Writes a chosen photo and returns the value to store on the account.
 *
 * The type is decided by the bytes, not by the name the file arrived with: a
 * `.png` that is really an executable is refused before anything is written,
 * and the mime recorded on the row is the one the signature proved.
 */
export function installPortrait(bytes: Uint8Array | Buffer, originalName?: string): string {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (buffer.length === 0) throw errors.validation('That image is empty.', 'avatar')
  if (buffer.length > MAX_PORTRAIT_BYTES) {
    throw errors.validation('That photo is larger than 6 MB. Pick a smaller one.', 'avatar')
  }

  const signature = signatureOfBytes(buffer)
  if (!signature) {
    throw errors.validation('That file is not a PNG, JPEG or WebP image.', 'avatar')
  }

  const id = randomUUID()
  const fileName = `${id}${signature.extension}`
  try {
    writeFileSync(join(mediaDirectory(), fileName), buffer)
  } catch {
    throw errors.validation('That photo could not be copied into the app.', 'avatar')
  }

  try {
    getDatabase()
      .prepare(
        `INSERT INTO media_assets (id, kind, file_name, original_name, mime, bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, KIND, fileName, originalName || fileName, signature.mime, buffer.length, new Date().toISOString())
  } catch (error) {
    // A row that failed to write must not leave a file behind with no owner.
    try {
      unlinkSync(join(mediaDirectory(), fileName))
    } catch {
      // Already gone is the good case.
    }
    throw error
  }

  return `${PREFIX}${id}`
}

/** The bytes behind a portrait id, or null when the file is missing. */
export function readPortraitFile(id: string): { bytes: Buffer; mime: string } | null {
  const row = rowFor(id)
  if (!row) return null
  try {
    const bytes = readFileSync(join(mediaDirectory(), row.file_name))
    if (bytes.length === 0) return null
    return { bytes, mime: row.mime }
  } catch {
    return null
  }
}

/**
 * Forgets a portrait that is no longer anyone's. Called after a replacement or
 * a switch back to initials, never before: a failed save must leave the old
 * photo intact rather than an empty circle.
 */
export function removePortrait(value: string | null | undefined): void {
  const id = portraitMediaId(value)
  if (!id) return
  const row = rowFor(id)
  if (!row) return
  try {
    unlinkSync(join(mediaDirectory(), row.file_name))
  } catch {
    // Already gone is the good case.
  }
  getDatabase().prepare('DELETE FROM media_assets WHERE id = ?').run(id)
}
