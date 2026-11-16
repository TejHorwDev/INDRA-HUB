import { env } from './env'
import { isObjectKey } from './storage'

/*
 * Absolute addresses.
 *
 * The loader will only download an https URL, so a stored file path is useless:
 * `/api/files/exes/x.exe` is not a location, it is a fragment. Everything the
 * database holds has to be complete.
 *
 * The origin comes from the request when the deployment has not been told what it
 * is — behind Render, Vercel or any proxy the forwarding headers are the truth.
 */

export function originOf(request: Request): string {
  const url = new URL(request.url)
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(':', '')
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.headers.get('host') ||
    url.host

  return `${proto}://${host}`
}

/**
 * The public address of a stored object.
 *
 * A bucket with its own public base is served from there; otherwise the API serves
 * it, which is what makes a private bucket work.
 */
export function objectUrl(request: Request, key: string): string {
  if (env.publicBaseUrl) return `${env.publicBaseUrl}/${key}`
  return `${originOf(request)}/api/files/${key}`
}

/**
 * The object key inside a URL we handed out.
 *
 * The panel stores absolute addresses, and the bucket is what actually holds the bytes.
 * To answer "is this file still there?" something has to get from one to the other.
 *
 * It used to look for `/api/files/` and for `PUBLIC_BASE_URL`, which was true while the
 * API was the only thing that ever served an object. It is not true any more: artwork is
 * handed out as a URL on the storage provider's own domain — Supabase's
 * `…/storage/v1/object/public/<bucket>/images/x.webm`, Backblaze's
 * `…/file/<bucket>/images/x.webm`, R2's `…/<key>` — and none of those contain the marker
 * it was looking for, so every artwork would have read as missing and a replaced file
 * would have been left behind in the bucket forever.
 *
 * So the rule is the one thing every address has in common: the path ends with a folder
 * this code issues and a filename inside it. Anything else — a GitHub release asset, a
 * link somebody pasted, a key that would escape its folder — returns null, because it is
 * not ours to check or delete.
 */
export function keyFromUrl(url: string): string | null {
  const raw = (url ?? '').trim()
  if (!raw) return null

  let pathname: string
  try {
    pathname = new URL(raw, 'https://placeholder.invalid').pathname
  } catch {
    return null
  }

  const match = /\/((?:exes|images|videos)\/[^/]+)$/.exec(pathname)
  if (!match) return null

  let key: string
  try {
    key = decodeURIComponent(match[1])
  } catch {
    return null
  }

  return isObjectKey(key) ? key : null
}

/** The prefix every key we issue starts with, by kind. */
export function kindOfKey(key: string): 'exe' | 'image' | 'video' | null {
  if (key.startsWith('exes/')) return 'exe'
  if (key.startsWith('images/')) return 'image'
  if (key.startsWith('videos/')) return 'video'
  return null
}

/*
 * A link, or nothing at all.
 *
 * The panel is trusted, but a config row is a string that reaches an `href` on the website
 * and a `Location` header on the download route, and `javascript:` in either of those is
 * not a link. Only http and https get through, and a value that is not one is published as
 * empty — the site then uses the built-in download, which always works.
 */
export function safeLink(value: string | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw || raw.length > 900) return ''
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

