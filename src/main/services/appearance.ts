import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { extname, join } from 'node:path'
import type { LoginAppearance, LoginBackground, PublicAppearance } from '@shared/types'
import { getDatabase } from '../db/database'
import { errors } from '../lib/errors'

/*
 * Administrator-installed media for the signed-out screens.
 *
 * The video is copied into <userData>/media and the database holds the record
 * that points at it. A multi-megabyte blob inside SQLite would be rewritten on
 * every checkpoint and copied into every backup, so the row keeps the metadata
 * and the file keeps the bytes — the panel, the sign-in screen and the log all
 * read the same record, so there is still exactly one source of truth.
 *
 * The renderer never touches the filesystem and never sees a path: it asks for
 * the bytes over IPC and plays them from a Blob URL. That was a deliberate
 * change from a custom indra-media:// scheme — a Blob URL is a plain Chromium
 * media source with no scheme privileges, no range handling and no CSP surface
 * to get wrong, and it behaves identically in dev and in the packaged app.
 */

const KIND = 'login_background'

/** Large enough for a looping background, small enough to keep in memory. */
const MAX_BYTES = 96 * 1024 * 1024
const MAX_BLUR = 40
const MAX_DIM = 92

const VIDEO_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg'
}

interface MediaRow {
  id: string
  kind: string
  file_name: string
  original_name: string
  mime: string
  bytes: number
  created_at: string
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Where the copied files live. Created on first use. */
export function mediaDirectory(): string {
  const directory = join(app.getPath('userData'), 'media')
  mkdirSync(directory, { recursive: true })
  return directory
}

function readSetting(key: string, fallback: string): string {
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

function assetRow(id: string): MediaRow | undefined {
  return getDatabase()
    .prepare('SELECT * FROM media_assets WHERE id = ? AND kind = ?')
    .get(id, KIND) as MediaRow | undefined
}

function toBackground(row: MediaRow): LoginBackground {
  return {
    id: row.id,
    mime: row.mime,
    originalName: row.original_name,
    bytes: row.bytes,
    createdAt: row.created_at
  }
}

/** The active row, but only while the file behind it is still on disk. */
function activeRow(): MediaRow | null {
  const assetId = readSetting('login_background_asset', '')
  const row = assetId ? assetRow(assetId) : undefined
  if (!row) return null
  const path = join(mediaDirectory(), row.file_name)
  return existsSync(path) ? row : null
}

export function readLoginAppearance(): LoginAppearance {
  const row = activeRow()
  return {
    background: row ? toBackground(row) : null,
    blur: clamp(Number(readSetting('login_background_blur', '18')), 0, MAX_BLUR),
    dim: clamp(Number(readSetting('login_background_dim', '46')), 0, MAX_DIM)
  }
}

export function publicAppearance(): PublicAppearance {
  const appearance = readLoginAppearance()
  return {
    assetId: appearance.background?.id ?? null,
    hasVideo: Boolean(appearance.background),
    mime: appearance.background?.mime ?? null,
    bytes: appearance.background?.bytes ?? 0,
    blur: appearance.blur,
    dim: appearance.dim
  }
}


/**
 * Wraps bytes that arrived from the workspace — already validated against the
 * same limits as an upload — into the local media folder under the cloud
 * asset id. Using that id as the local primary key is what lets the renderer's
 * Blob cache notice a replacement: a new cloud asset id is a new file.
 */
export function adoptBackground(input: {
  id: string
  bytes: Buffer
  mime: string
  originalName?: string
}): LoginAppearance {
  const mime = canonicalMime(input.mime)
  if (!mime) throw errors.validation('That video type cannot be played.', 'video')
  if (input.bytes.length === 0) throw errors.validation('That video is an empty file.', 'video')
  if (input.bytes.length > MAX_BYTES) {
    throw errors.validation('That video is larger than the app accepts.', 'video')
  }

  const fileName = `${input.id}${extensionFor(mime)}`
  const previous = activeRow()

  writeFileSync(join(mediaDirectory(), fileName), input.bytes)

  const db = getDatabase()
  db.prepare(
    `INSERT INTO media_assets (id, kind, file_name, original_name, mime, bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       file_name = excluded.file_name,
       mime = excluded.mime,
       bytes = excluded.bytes`
  ).run(
    input.id,
    KIND,
    fileName,
    input.originalName || fileName,
    mime,
    input.bytes.length,
    new Date().toISOString()
  )
  writeSetting('login_background_asset', input.id)

  // The previous file is only removed once the new one is in place.
  if (previous && previous.id !== input.id) {
    try {
      unlinkSync(join(mediaDirectory(), previous.file_name))
    } catch {
      // Already gone is the good case.
    }
    db.prepare('DELETE FROM media_assets WHERE id = ?').run(previous.id)
  }

  return readLoginAppearance()
}

/** `video/mp4; codecs=avc1` and `VIDEO/MP4` both become `video/mp4`. */
function canonicalMime(raw: string): string {
  const base = String(raw ?? '').split(';')[0].trim().toLowerCase()
  return extensionFor(base) ? base : ''
}

function extensionFor(mime: string): string {
  const found = Object.entries(VIDEO_TYPES).find(([, value]) => value === mime)
  return found ? found[0] : ''
}

/**
 * The video bytes for the renderer. Read here, in the main process, so the
 * renderer is handed a buffer and a mime type and nothing else.
 */
export function readLoginBackgroundFile(): { bytes: Buffer; mime: string } | null {
  const row = activeRow()
  if (!row) return null
  try {
    return { bytes: Buffer.from(readFileSync(join(mediaDirectory(), row.file_name))), mime: row.mime }
  } catch (error) {
    console.error('[appearance] could not read the background video', error)
    return null
  }
}

function readFileSync(path: string): Buffer {
  const descriptor = openSync(path, 'r')
  try {
    const size = statSync(path).size
    const buffer = Buffer.alloc(size)
    readSync(descriptor, buffer, 0, size, 0)
    return buffer
  } finally {
    closeSync(descriptor)
  }
}

/**
 * A quick sanity check on the container. The extension is the user's claim;
 * this is the file's own first bytes, so a renamed PDF or a truncated download
 * is refused here instead of failing silently in the browser later.
 */
function looksLikeVideo(path: string): boolean {
  let descriptor: number | null = null
  try {
    descriptor = openSync(path, 'r')
    const head = Buffer.alloc(16)
    const read = readSync(descriptor, head, 0, 16, 0)
    if (read < 12) return false
    if (head.subarray(4, 8).toString('latin1') === 'ftyp') return true // MP4 / M4V
    if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true // WebM
    if (head.subarray(0, 4).toString('latin1') === 'OggS') return true // Ogg
    return false
  } catch {
    return false
  } finally {
    if (descriptor !== null) closeSync(descriptor)
  }
}

/**
 * Chromium cannot decode HEVC/H.265 — the codec most phones record by default
 * — so an .mp4 that contains it plays back as a black rectangle with no error
 * anyone can see. Detect it at upload and say so, instead of shipping a file
 * that will never work. The sample reads the head and the tail because MP4
 * keeps its `moov` atom at whichever end the muxer chose.
 */
function unsupportedCodec(path: string, mime: string): string | null {
  let descriptor: number | null = null
  try {
    descriptor = openSync(path, 'r')
    const size = statSync(path).size
    const window = Math.min(size, 1_500_000)
    const head = Buffer.alloc(window)
    readSync(descriptor, head, 0, window, 0)
    const tail = Buffer.alloc(window)
    readSync(descriptor, tail, 0, window, Math.max(0, size - window))
    const sample = `${head.toString('latin1')}${tail.toString('latin1')}`

    const hevc =
      mime.startsWith('video/mp4') || mime === 'video/x-m4v'
        ? sample.includes('hvc1') || sample.includes('hev1') || sample.includes('dvh1')
        : sample.includes('V_MPEGH/ISO/HEVC') || sample.includes('hev1') || sample.includes('hvc1')

    if (hevc) {
      return 'That video is H.265 (HEVC), which this app cannot decode — it would play as a black screen. Export it as H.264 (MP4) or WebM and try again.'
    }
    return null
  } catch {
    return null
  } finally {
    if (descriptor !== null) closeSync(descriptor)
  }
}

function deleteAsset(id: string): void {
  const row = assetRow(id)
  if (row) {
    try {
      unlinkSync(join(mediaDirectory(), row.file_name))
    } catch {
      // The row is going either way; a missing file is already the good case.
    }
  }
  getDatabase().prepare('DELETE FROM media_assets WHERE id = ?').run(id)
}

/**
 * Copies a chosen video into the media folder and makes it the sign-in
 * background. The previous file is removed only after the new one is safely
 * in place, so a failed upload never leaves the app without a background.
 */
export function installLoginBackground(sourcePath: string, originalName: string): LoginAppearance {
  const stat = statSync(sourcePath, { throwIfNoEntry: false })
  if (!stat?.isFile()) throw errors.validation('That file could not be read.', 'video')

  const extension = extname(originalName || sourcePath).toLowerCase()
  const mime = VIDEO_TYPES[extension]
  if (!mime) {
    throw errors.validation(
      'Use an MP4 or WebM video. That file type cannot be played as a background.',
      'video'
    )
  }
  if (stat.size === 0) throw errors.validation('That video is an empty file.', 'video')
  if (stat.size > MAX_BYTES) {
    throw errors.validation(
      `That video is ${megabytes(stat.size)}. Keep it under ${MAX_BYTES / (1024 * 1024)} MB so the sign-in screen opens quickly.`,
      'video'
    )
  }
  if (!looksLikeVideo(sourcePath)) {
    throw errors.validation(
      'That file is not a video the app can play. Export it as MP4 (H.264) or WebM and try again.',
      'video'
    )
  }
  const codecProblem = unsupportedCodec(sourcePath, mime)
  if (codecProblem) throw errors.validation(codecProblem, 'video')

  const id = randomUUID()
  const fileName = `${id}${extension}`
  const previous = readLoginAppearance().background

  copyFileSync(sourcePath, join(mediaDirectory(), fileName))

  getDatabase()
    .prepare(
      `INSERT INTO media_assets (id, kind, file_name, original_name, mime, bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, KIND, fileName, originalName || fileName, mime, stat.size, new Date().toISOString())
  writeSetting('login_background_asset', id)

  if (previous && previous.id !== id) deleteAsset(previous.id)

  return readLoginAppearance()
}

export function removeLoginBackground(): LoginAppearance {
  const current = readLoginAppearance().background
  writeSetting('login_background_asset', '')
  if (current) deleteAsset(current.id)
  return readLoginAppearance()
}

/** Blur and dim are the only knobs; both are inert numbers, clamped here. */
export function writeTreatment(input: { blur: number; dim: number }): LoginAppearance {
  const blur = clamp(Number(input.blur), 0, MAX_BLUR)
  const dim = clamp(Number(input.dim), 0, MAX_DIM)
  writeSetting('login_background_blur', String(blur))
  writeSetting('login_background_dim', String(dim))
  return readLoginAppearance()
}

export const APPEARANCE_LIMITS = { maxBlur: MAX_BLUR, maxDim: MAX_DIM, maxVideoBytes: MAX_BYTES }

/** What the panel shows in its playback check. */
export function backgroundHealth(): {
  present: boolean
  readable: boolean
  bytes: number
  mime: string | null
} {
  const assetId = readSetting('login_background_asset', '')
  const row = assetId ? assetRow(assetId) : undefined
  if (!row) return { present: false, readable: false, bytes: 0, mime: null }

  // A stat, not a read: the point is whether the bytes are still there, and a
  // forty-megabyte read would make the check itself feel broken.
  try {
    const stat = statSync(join(mediaDirectory(), row.file_name))
    return {
      present: true,
      readable: stat.isFile() && stat.size > 0,
      bytes: stat.isFile() ? stat.size : row.bytes,
      mime: row.mime
    }
  } catch {
    return { present: true, readable: false, bytes: row.bytes, mime: row.mime }
  }
}
