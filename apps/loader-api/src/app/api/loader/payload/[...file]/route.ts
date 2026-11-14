import { assetUrl, isReleaseFile } from '@/lib/github'

export const dynamic = 'force-dynamic'

/*
 * GET /api/loader/payload/<tag>/<file>
 *
 * Streams the update payload from GitHub through this service.
 *
 * Two reasons this exists instead of handing the app a GitHub URL. The first is the
 * one that matters: `release-assets.githubusercontent.com` is filtered on a lot of
 * networks, and a filtered download is an app that never updates and never explains
 * why. The second is that this is the only address the app has to be able to reach,
 * and it already has to reach it for the catalogue.
 *
 * The body is passed straight through — no buffering, no rewriting — so a 1.5 MB
 * payload costs this service a stream and nothing else.
 */

type Params = { params: Promise<{ file: string[] }> }

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { file } = await params
  const [tag, name] = file

  if (!tag || !name || !isReleaseFile(tag, name)) {
    return Response.json({ error: 'No such payload.' }, { status: 404 })
  }

  try {
    const upstream = await fetch(assetUrl(tag, name), {
      redirect: 'follow',
      cache: 'no-store',
      headers: { accept: 'application/octet-stream' }
    })

    if (!upstream.ok || !upstream.body) {
      return Response.json(
        { error: `GitHub answered HTTP ${upstream.status} for that payload.` },
        { status: 502 }
      )
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': upstream.headers.get('content-length') ?? '',
        'accept-ranges': upstream.headers.get('accept-ranges') ?? 'none',
        /* The same bytes forever: a tag and a file name identify one build. */
        'cache-control': 'public, max-age=86400, immutable'
      }
    })
  } catch (error) {
    console.error('[loader/payload]', error instanceof Error ? error.message : error)
    return Response.json({ error: 'The payload could not be fetched.' }, { status: 502 })
  }
}
