import { env } from './env'

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
