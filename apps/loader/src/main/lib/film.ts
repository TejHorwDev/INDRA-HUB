import { app, net, protocol } from 'electron'
import { createHash } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { discardPartial, downloadToFile } from './downloader'

/*
 * The film, on disk.
 *
 * It was loaded from the panel every launch: a round trip to a free-tier server, which
 * then streamed it out of a bucket. That is fine for a 20 KB settings response and wrong
 * for a video — the film is the first thing on screen and the last thing to arrive.
 *
 * So it is fetched once, kept in the loader's own folder, and played from there. The
 * window then paints the film in the time it takes to open a local file, with no network
 * at all — and the next launch does not cost a byte of anybody's egress.
 *
 * A custom scheme rather than `file://` because the renderer is a web page with a strict
 * policy: `file:` is refused, and it should be. `indra-film:` is registered as standard
 * and secure, so a media element treats it exactly like https, ranges included.
 */

const SCHEME = 'indra-film'
const FOLDER = 'media'
const KEEP = 2

interface FilmRecord {
  url: string
  file: string
  bytes: number
}

function folder(): string {
  return join(app.getPath('userData'), FOLDER)
}

function record(): string {
  return join(folder(), 'film.json')
}

function nameFor(url: string): string {
  return `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.mp4`
}

function stored(): FilmRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(record(), 'utf8')) as Partial<FilmRecord>
    if (!parsed.url || !parsed.file) return null
    const path = join(folder(), parsed.file)
    const info = statSync(path)
    if (!info.isFile() || info.size === 0) return null
    return { url: parsed.url, file: parsed.file, bytes: info.size }
  } catch {
    return null
  }
}

/** True when this exact film is already on disk, whole. */
export function filmIsCached(url: string): boolean {
  const entry = stored()
  return Boolean(entry && entry.url === url)
}

/**
 * What the renderer should point a `<video>` at.
 *
 * The cached film when we have it, otherwise the remembered URL so the film still plays
 * while it is being downloaded for next time. Null when nothing is known at all.
 */
export function filmSource(remote: string): string | null {
  const url = remote.trim()
  if (!url) return null
  if (filmIsCached(url)) return `${SCHEME}://film/${nameFor(url)}`
  return url
}

/** The best source for whatever was published last, without a network round trip. */
export function currentFilmSource(): string | null {
  const entry = stored()
  return entry ? `${SCHEME}://film/${entry.file}` : null
}

/**
 * Registered before the app is ready, which is the only moment Electron allows it.
 */
export function registerFilmScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/**
 * Serves the cached film, with ranges.
 *
 * A media element seeks — that is how it loops, scrubs and starts in the middle — and a
 * response with no length cannot be seeked. Same lesson as the API learned, applied
 * locally, where it costs nothing.
 */
export function serveFilm(): void {
  protocol.handle(SCHEME, async (request) => {
    let file = ''
    try {
      // indra-film://film/<name>
      file = new URL(request.url).pathname.replace(/^\/+/, '')
    } catch {
      return new Response('Not found', { status: 404 })
    }

    // A name, not a path: nothing here may escape the folder.
    if (!/^[a-f0-9]{16}\.mp4$/.test(file)) return new Response('Not found', { status: 404 })

    const path = join(folder(), file)
    let size = 0
    try {
      size = statSync(path).size
    } catch {
      return new Response('Not found', { status: 404 })
    }

    const range = parseRange(request.headers.get('range'))
    if (!range) {
      return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(size),
          'accept-ranges': 'bytes',
          // The name changes when the film changes, so this is safe forever.
          'cache-control': 'public, max-age=31536000, immutable'
        }
      })
    }

    if (range.start >= size) {
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${size}` }
      })
    }

    const end = Math.min(range.end ?? size - 1, size - 1)
    return new Response(
      Readable.toWeb(createReadStream(path, { start: range.start, end })) as ReadableStream,
      {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(end - range.start + 1),
          'content-range': `bytes ${range.start}-${end}/${size}`,
          'accept-ranges': 'bytes',
          'cache-control': 'public, max-age=31536000, immutable'
        }
      }
    )
  })
}

function parseRange(header: string | null): { start: number; end?: number } | null {
  if (!header) return null
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const start = Number(match[1])
  const end = match[2] ? Number(match[2]) : undefined
  if (!Number.isFinite(start) || (end !== undefined && end < start)) return null
  return { start, end }
}

/** Deleting the film nobody plays any more, and the fragments of the ones that failed. */
function prune(keep: string): void {
  try {
    const files = readdirSync(folder())
    const keepers = new Set([keep, 'film.json'])
    const films = files
      .filter((name) => name.endsWith('.mp4'))
      .map((name) => ({ name, at: statSync(join(folder(), name)).mtimeMs }))
      .sort((left, right) => right.at - left.at)

    let seen = 0
    for (const film of films) {
      if (keepers.has(film.name)) continue
      seen += 1
      if (seen < KEEP) continue
      unlinkSync(join(folder(), film.name))
    }

    for (const name of files) {
      if (name.endsWith('.part')) unlinkSync(join(folder(), name))
    }
  } catch {
    /* housekeeping must never be the reason a launch fails */
  }
}

let downloading: Promise<boolean> | null = null

/**
 * Fetches the film for next time. Never blocks anything, never throws.
 *
 * Resolves true when the film at `url` is now on disk, which is the signal to tell the
 * renderer it can switch to the local source.
 */
export function ensureFilm(url: string): Promise<boolean> {
  const remote = url.trim()
  if (!remote || !/^https:\/\//.test(remote)) return Promise.resolve(false)
  if (filmIsCached(remote)) return Promise.resolve(false)
  // One download at a time: the catalogue is read twice on launch and both reads
  // would otherwise race for the same file.
  if (downloading) return downloading

  downloading = (async () => {
    const name = nameFor(remote)
    const target = join(folder(), name)
    const partial = `${target}.part`

    try {
      mkdirSync(folder(), { recursive: true })
      discardPartial(target)

      const controller = new AbortController()
      const result = await downloadToFile({
        url: remote,
        destination: target,
        signal: controller.signal,
        request: (input, init) => net.fetch(input, init as never)
      })

      if (result.bytes === 0) return false

      writeFileSync(record(), JSON.stringify({ url: remote, file: name, bytes: result.bytes }), 'utf8')
      prune(name)
      return true
    } catch (error) {
      console.error('[film] could not cache', error)
      try {
        if (existsSync(partial)) unlinkSync(partial)
      } catch {
        /* nothing to clean */
      }
      return false
    } finally {
      downloading = null
    }
  })()

  return downloading
}

/** Exposed for the simulation, which has no Electron protocol to talk to. */
export const _internals = { parseRange, nameFor, FOLDER }
