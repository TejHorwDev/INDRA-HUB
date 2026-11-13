import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AboutInfo, DeveloperPhoto } from '@shared/types'
import { getDatabase } from '../db/database'
import { errors } from '../lib/errors'
import { runningVersion } from '../lib/payload'
import { mediaDirectory } from './appearance'

/*
 * About: who made this app, and which version of it is running.
 *
 * The photo is the administrator's own, chosen from their disk in the admin
 * panel. It is copied into the app's media folder and the database keeps the
 * row that points at it — the same arrangement as the sign-in video, for the
 * same reasons: a few hundred kilobytes in SQLite would be rewritten on every
 * checkpoint, and a path handed to the renderer would be a filesystem surface
 * that has no business existing. The renderer receives bytes over IPC and makes
 * a Blob URL; it never sees where they came from.
 *
 * The bytes are checked, not trusted: the first few bytes of the file have to
 * be the signature of the image type its extension claims. A `.png` that is
 * really something else is refused before it is copied anywhere.
 */

const KIND = 'developer_photo'
const SETTING = 'developer_photo_asset'
const MAX_BYTES = 8 * 1024 * 1024

interface MediaRow {
  id: string
  file_name: string
  original_name: string
  mime: string
  bytes: number
  created_at: string
}

const SIGNATURES: Array<{ mime: string; extension: string; test: (head: Buffer) => boolean }> = [
  {
    mime: 'image/png',
    extension: '.png',
    test: (head) =>
      head.length >= 8 &&
      head[0] === 0x89 &&
      head[1] === 0x50 &&
      head[2] === 0x4e &&
      head[3] === 0x47 &&
      head[4] === 0x0d &&
      head[5] === 0x0a &&
      head[6] === 0x1a &&
      head[7] === 0x0a
  },
  {
    mime: 'image/jpeg',
    extension: '.jpg',
    test: (head) => head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
  },
  {
    mime: 'image/webp',
    extension: '.webp',
    test: (head) =>
      head.length >= 12 &&
      head.subarray(0, 4).toString('ascii') === 'RIFF' &&
      head.subarray(8, 12).toString('ascii') === 'WEBP'
  }
]

function signatureOf(path: string): { mime: string; extension: string } | null {
  const handle = openSync(path, 'r')
  try {
    const head = Buffer.alloc(16)
    const read = readSync(handle, head, 0, 16, 0)
    const slice = head.subarray(0, read)
    const match = SIGNATURES.find((entry) => entry.test(slice))
    return match ? { mime: match.mime, extension: match.extension } : null
  } finally {
    closeSync(handle)
  }
}

function readSetting(key: string, fallback = ''): string {
  const row = getDatabase().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? fallback
}

function writeSetting(key: string, value: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, new Date().toISOString())
}

/** The active row, but only while the file behind it is still on disk. */
function photoRow(): MediaRow | null {
  const assetId = readSetting(SETTING)
  if (!assetId) return null
  const row = getDatabase()
    .prepare('SELECT * FROM media_assets WHERE id = ? AND kind = ?')
    .get(assetId, KIND) as MediaRow | undefined
  if (!row) return null
  return existsSync(join(mediaDirectory(), row.file_name)) ? row : null
}

function toPhoto(row: MediaRow | null): DeveloperPhoto {
  return {
    hasPhoto: Boolean(row),
    mime: row?.mime ?? null,
    bytes: row?.bytes ?? 0,
    updatedAt: row?.created_at ?? null
  }
}

export function readAbout(): AboutInfo {
  return {
    appName: 'INDRA HUB',
    version: runningVersion(),
    developer: toPhoto(photoRow())
  }
}

/** The bytes, for the Blob URL the About card draws. Never a path. */
export function readDeveloperPhotoFile(): { bytes: Buffer; mime: string } | null {
  const row = photoRow()
  if (!row) return null
  try {
    return { bytes: readFileSync(join(mediaDirectory(), row.file_name)), mime: row.mime }
  } catch {
    return null
  }
}

/**
 * Installs a photo the administrator chose. The previous one is removed only
 * after the new one is on disk and recorded, so a failed replacement leaves the
 * old portrait in place rather than an empty circle.
 */
export function installDeveloperPhoto(sourcePath: string, originalName?: string): AboutInfo {
  if (!sourcePath) throw errors.validation('Choose an image first.', 'photo')

  let size = 0
  try {
    size = statSync(sourcePath).size
  } catch {
    throw errors.validation('That file could not be read.', 'photo')
  }
  if (size === 0) throw errors.validation('That image is empty.', 'photo')
  if (size > MAX_BYTES) throw errors.validation('That image is larger than 8 MB. Pick a smaller one.', 'photo')

  const signature = signatureOf(sourcePath)
  if (!signature) {
    throw errors.validation('That file is not a PNG, JPEG or WebP image.', 'photo')
  }

  const id = randomUUID()
  const fileName = `${id}${signature.extension}`
  const target = join(mediaDirectory(), fileName)
  try {
    writeFileSync(target, readFileSync(sourcePath))
  } catch {
    throw errors.validation('That image could not be copied into the app.', 'photo')
  }

  const previous = photoRow()
  const createdAt = new Date().toISOString()
  getDatabase()
    .prepare(
      `INSERT INTO media_assets (id, kind, file_name, original_name, mime, bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, KIND, fileName, originalName || fileName, signature.mime, size, createdAt)
  writeSetting(SETTING, id)

  if (previous && previous.id !== id) {
    try {
      unlinkSync(join(mediaDirectory(), previous.file_name))
    } catch {
      // Already gone is the good case.
    }
    getDatabase().prepare('DELETE FROM media_assets WHERE id = ?').run(previous.id)
  }

  return readAbout()
}

export function removeDeveloperPhoto(): AboutInfo {
  const row = photoRow()
  writeSetting(SETTING, '')
  if (row) {
    try {
      unlinkSync(join(mediaDirectory(), row.file_name))
    } catch {
      // Already gone is the good case.
    }
    getDatabase().prepare('DELETE FROM media_assets WHERE id = ?').run(row.id)
  }
  return readAbout()
}
