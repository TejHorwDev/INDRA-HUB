import {
  closeSync,
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
 * It is not a per-machine preference. The portrait belongs to the shared
 * workspace row, so the administrator sets it once and every installation
 * mirrors it — see push() and applyRemote() in workspace.ts, which upload and
 * adopt it exactly as they do the sign-in video. A machine that is not connected
 * to a workspace can still set one; it simply stays on that machine, and the
 * panel says so instead of implying it travelled.
 *
 * The bytes are checked, not trusted: the first few bytes of the file have to
 * be the signature of the image type its extension claims. A `.png` that is
 * really something else is refused before it is copied anywhere.
 */

const KIND = 'developer_photo'
const SETTING = 'developer_photo_asset'
/** '1' once the active portrait is known to be on the shared workspace too. */
const CLOUD_SETTING = 'developer_photo_cloud'
/**
 * '1' when the administrator removed a portrait that had been published, and the
 * row has not been cleared yet. Without it a removal made offline would be
 * undone by the next reconcile, which sees a row still pointing at the photo.
 */
const CLEAR_SETTING = 'developer_photo_clear'
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

/** The same test, over bytes already in memory. */
function signatureOfBytes(bytes: Buffer): { mime: string; extension: string } | null {
  const head = bytes.subarray(0, 16)
  const match = SIGNATURES.find((entry) => entry.test(head))
  return match ? { mime: match.mime, extension: match.extension } : null
}

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

/** The active row, whether or not the file behind it survived. */
function storedRow(): MediaRow | null {
  const assetId = readSetting(SETTING)
  if (!assetId) return null
  return (
    (getDatabase()
      .prepare('SELECT * FROM media_assets WHERE id = ? AND kind = ?')
      .get(assetId, KIND) as MediaRow | undefined) ?? null
  )
}

function filePathOf(row: MediaRow): string {
  return join(mediaDirectory(), row.file_name)
}

/** The active row, but only while the file behind it is still on disk. */
function photoRow(): MediaRow | null {
  const row = storedRow()
  if (!row) return null
  try {
    return statSync(filePathOf(row)).size > 0 ? row : null
  } catch {
    return null
  }
}

/*
 * `hasPhoto` answers "can the card draw something", and `stored` answers "is
 * there a record", and they are deliberately different questions. A record whose
 * file has disappeared is still installed as far as the workspace is concerned:
 * it must not be mistaken for "nobody ever chose a portrait", or a second PC
 * would publish null over the administrator's photo.
 */
function toPhoto(row: MediaRow | null): DeveloperPhoto {
  return {
    hasPhoto: Boolean(row),
    mime: row?.mime ?? null,
    bytes: row?.bytes ?? 0,
    updatedAt: row?.created_at ?? null,
    stored: Boolean(storedRow()),
    cloud: readSetting(CLOUD_SETTING) === '1'
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
    const bytes = readFileSync(filePathOf(row))
    if (bytes.length === 0) return null
    return { bytes, mime: row.mime }
  } catch {
    return null
  }
}

/**
 * The active portrait as bytes, for the workspace to upload. Null when there is
 * nothing installed or the file cannot be read back.
 */
export function readDeveloperPhotoForUpload(): {
  id: string
  bytes: Buffer
  mime: string
  extension: string
  originalName: string
} | null {
  const row = photoRow()
  if (!row) return null
  try {
    const bytes = readFileSync(filePathOf(row))
    if (bytes.length === 0) return null
    const extension = row.file_name.slice(row.file_name.lastIndexOf('.')) || '.png'
    return { id: row.id, bytes, mime: row.mime, extension, originalName: row.original_name }
  } catch {
    return null
  }
}

/**
 * The id of the portrait that is actually on disk right now, or null.
 *
 * A stat, not a read: the reconcile asks this on every poll and must stay
 * cheap. It is how a file that went missing gets noticed without waiting for
 * the shared row to change.
 */
export function installedDeveloperPhotoId(): string | null {
  return photoRow()?.id ?? null
}

/** Records whether this portrait also lives on the shared workspace. */
export function setDeveloperPhotoCloud(on: boolean): void {
  writeSetting(CLOUD_SETTING, on ? '1' : '0')
}

/** True while a published portrait still has to be cleared from the row. */
export function developerPhotoNeedsClear(): boolean {
  return readSetting(CLEAR_SETTING) === '1'
}

export function clearDeveloperPhotoNeedsClear(): void {
  writeSetting(CLEAR_SETTING, '0')
}

/**
 * Writes bytes that were already checked into the media folder under a given
 * id. The id is the cloud asset id when the bytes came from the workspace, so
 * the row, the object name and the local file all agree — which is what lets
 * two machines recognise the same portrait as the same portrait.
 */
export function adoptDeveloperPhoto(input: {
  id: string
  bytes: Buffer
  mime: string
  originalName?: string | null
  createdAt?: string | null
}): AboutInfo {
  /*
   * Checked again here, not only by the caller. These bytes may have come off
   * the wire, and a row is not a promise: whatever it claims the type is, the
   * file has to actually start with that type's signature before it is written
   * to disk or handed to the renderer.
   */
  const signature = signatureOfBytes(input.bytes)
  if (!signature) throw errors.validation('That file is not a PNG, JPEG or WebP image.', 'photo')
  if (input.bytes.length > MAX_BYTES) {
    throw errors.validation('That image is larger than 8 MB.', 'photo')
  }
  const extension = signature.extension
  const fileName = `${input.id}${extension}`
  try {
    writeFileSync(join(mediaDirectory(), fileName), input.bytes)
  } catch {
    throw errors.validation('That image could not be copied into the app.', 'photo')
  }

  const previous = storedRow()
  getDatabase()
    .prepare(
      `INSERT INTO media_assets (id, kind, file_name, original_name, mime, bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         file_name = excluded.file_name,
         original_name = excluded.original_name,
         mime = excluded.mime,
         bytes = excluded.bytes,
         created_at = excluded.created_at`
    )
    .run(
      input.id,
      KIND,
      fileName,
      input.originalName || fileName,
      signature.mime,
      input.bytes.length,
      input.createdAt || new Date().toISOString()
    )
  writeSetting(SETTING, input.id)

  if (previous && previous.id !== input.id) {
    try {
      unlinkSync(filePathOf(previous))
    } catch {
      // Already gone is the good case.
    }
    getDatabase().prepare('DELETE FROM media_assets WHERE id = ?').run(previous.id)
  }

  return readAbout()
}

/**
 * Installs a photo the administrator chose. The previous one is removed only
 * after the new one is on disk and recorded, so a failed replacement leaves the
 * old portrait in place rather than an empty circle.
 *
 * The portrait starts out local. workspace.ts uploads it on the next push and
 * flips the cloud flag once the row actually points at it; until then the panel
 * says "this PC only", which is the truth.
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

  const previous = storedRow()
  const createdAt = new Date().toISOString()
  getDatabase()
    .prepare(
      `INSERT INTO media_assets (id, kind, file_name, original_name, mime, bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, KIND, fileName, originalName || fileName, signature.mime, size, createdAt)
  writeSetting(SETTING, id)
  writeSetting(CLOUD_SETTING, '0')
  writeSetting(CLEAR_SETTING, '0')

  if (previous && previous.id !== id) {
    try {
      unlinkSync(filePathOf(previous))
    } catch {
      // Already gone is the good case.
    }
    getDatabase().prepare('DELETE FROM media_assets WHERE id = ?').run(previous.id)
  }

  return readAbout()
}

/**
 * Removes the portrait from this machine. Whether that also clears it from the
 * shared workspace is decided by workspace.ts — this only forgets it here.
 */
export function removeDeveloperPhoto(): AboutInfo {
  const row = storedRow()
  const wasPublished = readSetting(CLOUD_SETTING) === '1'
  writeSetting(SETTING, '')
  writeSetting(CLOUD_SETTING, '0')
  if (wasPublished) writeSetting(CLEAR_SETTING, '1')
  if (row) {
    try {
      unlinkSync(filePathOf(row))
    } catch {
      // Already gone is the good case.
    }
    getDatabase().prepare('DELETE FROM media_assets WHERE id = ?').run(row.id)
  }
  return readAbout()
}
