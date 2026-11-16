import { Readable } from 'node:stream'
import { parseRange } from '@/lib/http-range'
import { directUrl, isObjectKey, readObject } from '@/lib/storage'
import { ensureStorageConfig } from '@/lib/storage-config'

/*
 * GET /api/files/<key>
 *
 * Serves a stored object, for deployments where the bucket is private — which is
 * the default, and the right default. The bytes are streamed, never buffered, so
 * a 300 MB installer costs the server a socket rather than its memory.
 *
 * This is what the loader downloads from when PUBLIC_BASE_URL is not set, and what
 * the panel embeds for product images.
 *
 * Every response says how big it is and answers `Range`. That is not politeness: each
 * object used to arrive as a chunked stream of unknown length, so an installer download
 * could not compute a percentage — the loader's bar sat at 0% while bytes were arriving —
 * and a resuming retry had to start again from zero. A looping `<video>` over a response
 * with no length and no ranges has to re-fetch the file to play it a second time, which is
 * why the film seemed to pause. Both are fixed by being honest about the size.
 */
export const dynamic = 'force-dynamic'

const TYPES: Record<string, string> = {
  exe: 'application/octet-stream',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime'
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> }
): Promise<Response> {
  /*
   * A failure here is the difference between a card that plays and a card that does not,
   * and a bare 500 says nothing about which of the four things behind this route broke —
   * the bucket, the signature, the stream, or the name. The detail is returned as well as
   * logged, the same way the update route does it, because the person who can see the JSON
   * is the person who can fix it.
   */
  try {
    return await serve(request, await params)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('[files]', detail)
    return Response.json(
      { error: 'The file could not be read.', detail: detail.slice(0, 300) },
      { status: 500, headers: { 'cache-control': 'no-store' } }
    )
  }
}

async function serve(request: Request, { key }: { key: string[] }): Promise<Response> {
  // The bucket may have been changed in the panel since this process started.
  await ensureStorageConfig()
  const path = key.join('/')

  // No traversal, no absolute paths: the key is a name we issued.
  if (!isObjectKey(path)) {
    return new Response('Not found', { status: 404 })
  }

  /*
   * A film and a card image go straight to the bucket.
   *
   * Streaming them through this process puts two hops and a free-tier server between the
   * person and the picture, which is how a backdrop arrives several seconds after the
   * window and a library of cards paints one by one. Both are read far more often than
   * they are written, and neither is secret — an installer is, and it stays proxied:
   * downloaded once, hashed, verified.
   */
  /*
   * Only the film is redirected, and the reason is worth writing down because the
   * opposite was tried.
   *
   * A signed address is a *different* address every time it is issued, so a browser can
   * never reuse what it fetched — every launch, every card, downloaded again from the
   * start, and a video that stutters while it streams what it should already have. Card
   * artwork is small and read constantly, so it keeps one stable address and one
   * immutable cache entry. The film is different: the loader keeps its own copy on disk,
   * so the redirect costs nothing after the first play.
   */
  if (path.startsWith('videos/')) {
    const direct = await directUrl(path)
    if (direct) {
      return new Response(null, {
        status: 302,
        headers: { location: direct, 'cache-control': 'no-store' }
      })
    }
  }

  /*
   * `Range: bytes=start-end`, the one form that matters. Anything else — multi-range,
   * a suffix length, a unit other than bytes — is ignored and the whole file is sent,
   * which is what the standard says a server may do.
   */
  const requested = parseRange(request.headers.get('range'))

  const object = await readObject(path, requested ?? undefined)
  if (!object) return new Response('Not found', { status: 404 })

  // A range that starts past the end is a 416 with the real size, so the client can
  // correct itself instead of guessing.
  if (requested && object.size > 0 && requested.start >= object.size) {
    return new Response(null, {
      status: 416,
      headers: { 'content-range': `bytes */${object.size}`, 'accept-ranges': 'bytes' }
    })
  }

  const stream = object.stream

  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  /*
   * A fallback by folder, not by guesswork.
   *
   * `x-content-type-options: nosniff` is sent below, and it is not a decoration: a
   * video served as `application/octet-stream` will not play, and neither will an
   * image with no extension. The folder says what the file is even when the name
   * does not.
   */
  const fallback = path.startsWith('videos/')
    ? 'video/mp4'
    : path.startsWith('images/')
      ? 'image/png'
      : 'application/octet-stream'
  const type = TYPES[extension] ?? fallback

  return new Response(
    Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>,
    {
      status: object.range ? 206 : 200,
      headers: {
        'content-type': type,
        'accept-ranges': 'bytes',
        ...(object.length > 0 ? { 'content-length': String(object.length) } : {}),
        ...(object.range && object.size > 0
          ? { 'content-range': `bytes ${object.range.start}-${object.range.end}/${object.size}` }
          : {}),
        // Images can be cached; an installer is fetched once and verified.
        /*
         * A film is fetched once per person and then cached; ranges matter for it,
         * which is why the response is a stream and not a buffered body.
         */
        /*
         * An image keeps its key for life — every upload makes a new one — so it can be
         * cached for a year without ever serving a stale picture. That is the difference
         * between a card that paints and a card that arrives.
         */
        'cache-control': type.startsWith('video/') || type.startsWith('image/')
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=300',
        'x-content-type-options': 'nosniff'
      }
    }
  )
}
