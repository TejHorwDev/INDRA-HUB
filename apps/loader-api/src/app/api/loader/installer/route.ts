import { latestLoaderRelease } from '@/lib/github'

export const dynamic = 'force-dynamic'

/*
 * GET /api/loader/installer
 *
 * The Windows installer, streamed from the newest release through this service.
 *
 * Installers are 120 MB and they do not belong in a bucket on a free plan — but they
 * also cannot be handed out as a raw `release-assets.githubusercontent.com` address,
 * because that host is filtered on some networks, and a download link that does not
 * work is how a customer ends up with no app at all.
 *
 * So the file stays on GitHub, where it is free and versioned, and this route is a
 * pipe to it. Range requests are passed through, which matters more than it looks:
 * browsers and download managers resume a 120 MB transfer in pieces, and a proxy that
 * ignores `Range` turns every restart into a full download from zero.
 *
 * Nothing is buffered. The response body is the upstream body.
 */

export async function GET(request: Request): Promise<Response> {
  try {
    const release = await latestLoaderRelease()
    if (!release) {
      return Response.json({ error: 'No release has been published yet.' }, { status: 404 })
    }

    const name = `INDRA-LOADER-Setup-${release.version}.exe`
    const url = `https://github.com/TejHorwDev/INDRA-HUB/releases/download/${release.tag}/${name}`

    /*
     * `?probe=1` answers with the size instead of the bytes.
     *
     * A 120 MB window is not a way to check whether a download works, and the panel
     * wants to print "what is published" without pulling the file. One range request
     * for the first byte gets GitHub's own `content-range`, which carries the total.
     */
    if (new URL(request.url).searchParams.get('probe') === '1') {
      const probe = await fetch(url, {
        redirect: 'follow',
        cache: 'no-store',
        headers: { range: 'bytes=0-0' }
      })
      const total = Number(
        /\/(\d+)$/.exec(probe.headers.get('content-range') ?? '')?.[1] ??
          probe.headers.get('content-length') ??
          0
      )
      return Response.json(
        {
          version: release.version,
          tag: release.tag,
          name,
          bytes: Number.isFinite(total) ? total : 0,
          reachable: probe.ok || probe.status === 206
        },
        { headers: { 'cache-control': 'no-store' } }
      )
    }

    const range = request.headers.get('range')
    const upstream = await fetch(url, {
      redirect: 'follow',
      cache: 'no-store',
      headers: range ? { range } : {}
    })

    if (!upstream.ok && upstream.status !== 206) {
      return Response.json(
        { error: `GitHub answered HTTP ${upstream.status} for that installer.` },
        { status: 502 }
      )
    }

    const headers = new Headers({
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${name}"`,
      'accept-ranges': upstream.headers.get('accept-ranges') ?? 'bytes',
      /*
       * A tag names one build forever, but the *newest* tag changes — so this is
       * short-lived on purpose. A stale installer handed out for a day is worse than
       * a second round trip.
       */
      'cache-control': 'public, max-age=300'
    })
    for (const header of ['content-length', 'content-range']) {
      const value = upstream.headers.get(header)
      if (value) headers.set(header, value)
    }

    return new Response(upstream.body, { status: upstream.status, headers })
  } catch (error) {
    console.error('[loader/installer]', error instanceof Error ? error.message : error)
    return Response.json({ error: 'The installer could not be fetched.' }, { status: 502 })
  }
}
