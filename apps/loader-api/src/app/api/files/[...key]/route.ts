import { Readable } from 'node:stream'
import { isObjectKey, openObject } from '@/lib/storage'

/*
 * GET /api/files/<key>
 *
 * Serves a stored object, for deployments where the bucket is private — which is
 * the default, and the right default. The bytes are streamed, never buffered, so
 * a 300 MB installer costs the server a socket rather than its memory.
 *
 * This is what the loader downloads from when PUBLIC_BASE_URL is not set, and what
 * the panel embeds for product images.
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
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> }
): Promise<Response> {
  const { key } = await params
  const path = key.join('/')

  // No traversal, no absolute paths: the key is a name we issued.
  if (!isObjectKey(path)) {
    return new Response('Not found', { status: 404 })
  }

  const stream = await openObject(path)
  if (!stream) return new Response('Not found', { status: 404 })

  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  const type = TYPES[extension] ?? 'application/octet-stream'

  return new Response(
    Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>,
    {
      headers: {
        'content-type': type,
        // Images can be cached; an installer is fetched once and verified.
        /*
         * A film is fetched once per person and then cached; ranges matter for it,
         * which is why the response is a stream and not a buffered body.
         */
        'cache-control': type.startsWith('video/')
          ? 'public, max-age=86400'
          : type.startsWith('image/')
            ? 'public, max-age=3600'
            : 'public, max-age=300',
        'accept-ranges': 'bytes',
        'x-content-type-options': 'nosniff'
      }
    }
  )
}
