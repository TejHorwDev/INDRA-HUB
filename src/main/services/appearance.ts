import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  unlinkSync
} from 'node:fs'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import type { LoginAppearance, LoginBackground, PublicAppearance } from '@shared/types'
import { getDatabase } from '../db/database'
import { errors } from '../lib/errors'

/*
 * Administrator-installed media for the signed-out screens.
 *
 * The video itself is copied into <userData>/media and the database holds the
 * record that points at it. A multi-megabyte blob inside SQLite would be
 * rewritten on every checkpoint and copied into every backup, so the row keeps
 * the metadata and the file keeps the bytes — the panel, the sign-in screen and
 * the protocol handler all read the same record, so there is still exactly one
 * source of truth.
 *
 * The renderer never touches the filesystem: it plays indra-media://asset/<id>,
 * which the main process resolves through the database. An id that is not in
 * the table returns 404, so no path in a URL can ever reach a file outside the
 * media folder.
 */

export const MEDIA_SCHEME = 'indra-media'
const KIND = 'login_background'

/** Large enough for a looping background, small enough to open instantly. */
const MAX_BYTES = 200 * 1024 * 1024
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
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`
}

/** Where the copied files live. Created on first use. */
export function mediaDirectory(): string {
  const directory = join(app.getPath('userData'), 'media')
  mkdirSync(directory, { recursive: true })
  return directory
}

export function mediaUrl(id: string): string {
  return `${MEDIA_SCHEME}://asset/${id}`
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
    url: mediaUrl(row.id),
    mime: row.mime,
    originalName: row.original_name,
    bytes: row.bytes,
    createdAt: row.created_at
  }
}

/**
 * The active background, if the file behind it still exists. A row whose file
 * was removed outside the app must not leave the sign-in screen with a dead
 * <video>, so the record is checked against the disk on every read.
 */
export function readLoginAppearance(): LoginAppearance {
  const assetId = readSetting('login_background_asset', '')
  const row = assetId ? assetRow(assetId) : undefined
  const onDisk = row ? existsSync(join(mediaDirectory(), row.file_name)) : false

  return {
    background: row && onDisk ? toBackground(row) : null,
    blur: clamp(Number(readSetting('login_background_blur', '18')), 0, MAX_BLUR),
    dim: clamp(Number(readSetting('login_background_dim', '58')), 0, MAX_DIM)
  }
}

export function publicAppearance(): PublicAppearance {
  const appearance = readLoginAppearance()
  return {
    url: appearance.background?.url ?? null,
    mime: appearance.background?.mime ?? null,
    blur: appearance.blur,
    dim: appearance.dim
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
  if (stat.size === 0) throw errors.validation('That video is empty file.', 'video')
  if (stat.size > MAX_BYTES) {
    throw errors.validation(
      `That video is ${megabytes(stat.size)}. Keep it under ${MAX_BYTES / (1024 * 1024)} MB so the sign-in screen still opens quickly.`,
      'video'
    )
  }
  if (!looksLikeVideo(sourcePath)) {
    throw errors.validation(
      'That file is not a video the app can play. Export it as MP4 (H.264) or WebM and try again.',
      'video'
    )
  }

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

/**
 * Serves indra-media://asset/<id>.
 *
 * Range requests are answered here rather than left to the file loader, so the
 * video can seek, loop and start playing before the whole file is read.
 */
export async function handleMediaRequest(request: Request): Promise<Response> {
  try {
    const id = new URL(request.url).pathname.replace(/^\/+/, '')
    const row = id ? assetRow(id) : undefined
    if (!row) return new Response('Not found', { status: 404 })

    const path = join(mediaDirectory(), row.file_name)
    const stat = statSync(path, { throwIfNoEntry: false })
    if (!stat?.isFile()) return new Response('Not found', { status: 404 })

    const total = stat.size
    const base: Record<string, string> = {
      'content-type': row.mime,
      'accept-ranges': 'bytes',
      'cache-control': 'no-store'
    }

    const range = request.headers.get('range')
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range)
      if (match) {
        const start = match[1] ? Number(match[1]) : 0
        const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1
        if (!Number.isFinite(start) || start < 0 || start > end) {
          return new Response(null, {
            status: 416,
            headers: { 'content-range': `bytes */${total}` }
          })
        }
        const slice = createReadStream(path, { start, end })
        return new Response(Readable.toWeb(slice) as ReadableStream, {
          status: 206,
          headers: {
            ...base,
            'content-length': String(end - start + 1),
            'content-range': `bytes ${start}-${end}/${total}`
          }
        })
      }
    }

    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      status: 200,
      headers: { ...base, 'content-length': String(total) }
    })
  } catch (error) {
    console.error('[media] failed to serve asset', error)
    return new Response('Media unavailable', { status: 500 })
  }
}
