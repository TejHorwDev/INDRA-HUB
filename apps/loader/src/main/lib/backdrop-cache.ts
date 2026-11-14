import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/*
 * The last film the catalogue published.
 *
 * The launch card is on screen before anything has been fetched — that is the
 * point of it — so it cannot ask the panel what to play. It can only remember.
 * This is that memory: one line of JSON in the app's own folder, written every
 * time the catalogue is read, read once when the card is built.
 *
 * A file rather than a window handshake because the card exists for a second and a
 * half and a round trip between two processes is a visible delay for a background.
 * Nothing here is trusted: a missing, unreadable or malformed file means "no film",
 * which is exactly the state a first launch is in.
 */

let cached: string | null = null

function file(): string {
  return join(app.getPath('userData'), 'backdrop.json')
}

/** What the last successful catalogue read said. Empty when nothing is known. */
export function cachedVideo(): string {
  if (cached !== null) return cached

  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as { video?: unknown }
    cached = typeof raw.video === 'string' ? raw.video.trim() : ''
  } catch {
    cached = ''
  }

  return cached
}

/** Remembers a film for the next launch. Called after every catalogue read. */
export function rememberVideo(url: string): void {
  const next = url.trim()
  if (next === cached) return

  cached = next
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(file(), JSON.stringify({ video: next }))
  } catch {
    // A cache that cannot be written is still a working app.
  }
}
