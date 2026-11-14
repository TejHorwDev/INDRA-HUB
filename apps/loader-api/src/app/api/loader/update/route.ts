import { latestLoaderRelease } from '@/lib/github'
import { originOf } from '@/lib/url'

export const dynamic = 'force-dynamic'

/*
 * GET /api/loader/update
 *
 * What the desktop app asks when it starts: is there a newer build than mine, and
 * where do I get it?
 *
 * The answer carries the payload URL on this domain rather than GitHub's, which is
 * the entire point — the app's own network can often reach this service when it
 * cannot reach GitHub's release hosts, and a redirect the app never has to follow
 * is a failure it never has to survive.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const release = await latestLoaderRelease()

    if (!release) {
      return Response.json(
        { update: null },
        { headers: { 'cache-control': 'no-store' } }
      )
    }

    const origin = originOf(request)
    const url = `${origin}/api/loader/payload/${release.tag}/${encodeURIComponent(release.manifest.file)}`

    return Response.json(
      {
        update: {
          version: release.version,
          tag: release.tag,
          publishedAt: release.publishedAt,
          file: release.manifest.file,
          sha256: release.manifest.sha256,
          size: release.manifest.size,
          url
        }
      },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    /*
     * A 503 with a sentence, not an empty success.
     *
     * The app treats a failed update check as "try again later" either way, but the
     * difference between "GitHub is down" and "there is no update" is the difference
     * between waiting and believing you are current.
     */
    const reason = error instanceof Error ? error.message : String(error)
    console.error('[loader/update]', reason)
    /*
     * The reason is returned as well as logged. Without a Render log tab open, a 503
     * with no detail is indistinguishable from every other way this can fail, and the
     * person who can see the JSON is the person who can fix it.
     */
    return Response.json(
      { error: 'The release feed is not reachable right now.', detail: reason.slice(0, 200) },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    )
  }
}
