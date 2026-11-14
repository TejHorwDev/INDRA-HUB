import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/*
 * The download itself, with no Electron in it.
 *
 * Kept separate from the service that owns it so it can be proven against a real
 * HTTP server and a real filesystem — which is the only way to know that a
 * resumed download, a rejected hash and an atomic rename actually behave.
 *
 * The three rules:
 *
 *  1. Nothing is written directly to its final name. Bytes go to `<file>.part`,
 *     and the rename happens only after the hash matches. A cancelled download is
 *     therefore never mistaken for an installed application.
 *  2. A partial file is resumed, not restarted. For a 300 MB installer on a
 *     domestic connection that is the difference between a retry and a redo.
 *  3. When a hash is published, it is the acceptance test. A file that arrives
 *     with the wrong bytes is deleted, not launched.
 */

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

export interface DownloadOptions {
  url: string
  /** Final path. Its parent directory is created. */
  destination: string
  /** Optional, but if given the download is rejected unless it matches. */
  sha256?: string
  signal: AbortSignal
  onProgress?: (progress: { received: number; total: number; bytesPerSecond: number }) => void
  /** Injected so a simulation can use Node's fetch while the app uses Electron's. */
  request?: Fetch
  /** Bytes already on disk from a previous attempt. */
  resumeFrom?: number
}

export interface DownloadResult {
  path: string
  bytes: number
  sha256: string
  /** True when the server honoured a Range request and the file was continued. */
  resumed: boolean
}

function partPath(destination: string): string {
  return `${destination}.part`
}

/** Bytes already downloaded, or 0 when there is nothing to resume. */
export function partialBytes(destination: string): number {
  try {
    return statSync(partPath(destination)).size
  } catch {
    return 0
  }
}

/**
 * Bytes from a previous attempt, but only if they are recent enough to trust.
 *
 * Resuming is worth a lot — a 20 MB installer on a bad line — but an abandoned fragment
 * from a file that has since been replaced would produce a hash mismatch at best, and at
 * worst a corrupted binary. A day is the line.
 */
export function resumableBytes(destination: string, maxAgeMs = 24 * 60 * 60 * 1000): number {
  try {
    const info = statSync(partPath(destination))
    if (Date.now() - info.mtimeMs > maxAgeMs) return 0
    return info.size
  } catch {
    return 0
  }
}

export function discardPartial(destination: string): void {
  try {
    unlinkSync(partPath(destination))
  } catch {
    /* nothing to discard */
  }
}

export async function downloadToFile(options: DownloadOptions): Promise<DownloadResult> {
  const request: Fetch = options.request ?? ((url, init) => fetch(url, init))
  const part = partPath(options.destination)
  const parent = join(options.destination, '..')
  mkdirSync(parent, { recursive: true })

  const resumeFrom = options.resumeFrom ?? partialBytes(options.destination)
  const headers: Record<string, string> = { accept: '*/*' }
  if (resumeFrom > 0) headers['range'] = `bytes=${resumeFrom}-`

  const response = await request(options.url, {
    signal: options.signal,
    headers,
    redirect: 'follow',
    cache: 'no-store'
  })

  if (!response.ok) {
    // 416: the file on disk is already everything the server has.
    if (response.status === 416) discardPartial(options.destination)
    throw new Error(`HTTP ${response.status}`)
  }

  const continued = response.status === 206
  const start = continued ? resumeFrom : 0
  if (!continued) discardPartial(options.destination)

  const length = Number(response.headers.get('content-length')) || 0
  const total = start + length

  if (!response.body) throw new Error('the server sent no body')

  const hash = createHash('sha256')
  let received = start
  let windowStart = Date.now()
  let windowBytes = 0

  // A hash covers the whole file, so a resumed download has to hash what is
  // already on disk before appending to it.
  if (start > 0) {
    const { readFileSync } = await import('node:fs')
    hash.update(readFileSync(part))
  }

  const sink = createWriteStream(part, { flags: continued ? 'a' : 'w' })

  try {
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          hash.update(chunk)
          received += chunk.length
          windowBytes += chunk.length

          const now = Date.now()
          if (now - windowStart >= 250) {
            const elapsed = Math.max(1, now - windowStart)
            options.onProgress?.({
              received,
              total,
              bytesPerSecond: Math.round((windowBytes * 1000) / elapsed)
            })
            windowStart = now
            windowBytes = 0
          }

          yield chunk
        }
      },
      sink
    )

    options.onProgress?.({ received, total, bytesPerSecond: 0 })
  } catch (error) {
    sink.destroy()
    throw error
  }

  const bytes = (await stat(part)).size
  const digest = hash.digest('hex')

  if (options.sha256 && digest.toLowerCase() !== options.sha256.toLowerCase()) {
    discardPartial(options.destination)
    throw new Error('checksum mismatch')
  }

  // The rename is the commit: until it happens, there is no installed file.
  await rename(part, options.destination)

  return { path: options.destination, bytes, sha256: digest, resumed: start > 0 }
}

/** True when a previous attempt left bytes behind that a retry could use. */
export function canResume(destination: string): boolean {
  return existsSync(partPath(destination)) && partialBytes(destination) > 0
}

/** Files in a directory, for reporting what is actually installed. */
export function filesIn(directory: string): string[] {
  try {
    return readdirSync(directory)
  } catch {
    return []
  }
}
