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
 * To answer "is this file still there?" something has to get from one to the other, and
 * this is it: the tail of `/api/files/<key>`, or of the public base when the bucket is
 * world-readable.
 *
 * Anything else — a GitHub release asset, a link somebody pasted, a key that would
 * escape its folder — returns null, because it is not ours to check or delete.
 */
export function keyFromUrl(url: string): string | null {
  const raw = (url ?? '').trim()
  if (!raw) return null

  const marker = '/api/files/'
  let tail = ''
  const at = raw.indexOf(marker)
  if (at >= 0) {
    tail = raw.slice(at + marker.length)
  } else if (env.publicBaseUrl && raw.startsWith(env.publicBaseUrl)) {
    tail = raw.slice(env.publicBaseUrl.length)
  } else {
    // No public base and no marker: not an address this deployment serves.
    return null
  }

  // A query string or fragment is not part of the key.
  tail = tail.split('?')[0].split('#')[0].replace(/^\/+/, '')

  try {
    tail = decodeURIComponent(tail)
  } catch {
    return null
  }

  return isObjectKey(tail) ? tail : null
}

/** The prefix every key we issue starts with, by kind. */
export function kindOfKey(key: string): 'exe' | 'image' | 'video' | null {
  if (key.startsWith('exes/')) return 'exe'
  if (key.startsWith('images/')) return 'image'
  if (key.startsWith('videos/')) return 'video'
  return null
}
