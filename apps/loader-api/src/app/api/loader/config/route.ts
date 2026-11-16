import { safeLink } from '@/lib/url'
import { databaseReady } from '@/lib/env'
import { readConfig } from '@/lib/db'
import { serverError } from '@/lib/http'

/*
 * GET /api/loader/config
 *
 * The website link and the sign-in film. The social fields the first draft carried
 * are gone from the app, so they are not published either — a field nobody renders
 * is a field nobody should have to keep filled in.
 */
export const dynamic = 'force-dynamic'

/*
 * The film is not just a file, it is a file at a size. A 1080p clip behind a 900px
 * window at full sharpness fights every label on the screen, and the person who owns
 * the film is the only one who can say how far to soften it.
 *
 * So the panel publishes two numbers with it: how much blur, and how much dark. Both
 * are clamped here rather than trusted — the app applies them directly to a video
 * element, and a stored 900 would blur the window into a single grey rectangle.
 */
const limit = (value: string | undefined, max: number): number => {
  const number = Number(value ?? 0)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.min(max, Math.round(number * 10) / 10)
}

export async function GET(): Promise<Response> {
  if (!databaseReady()) {
    return Response.json(
      { website: '', video: '', download: '', brandName: 'INDRA', brandMark: 'INDRA', brandTagline: '' },
      { headers: { 'cache-control': 'no-store' } }
    )
  }

  try {
    const config = await readConfig()
    return Response.json(
      {
        website: config.website ?? '',
        video: config.video ?? '',
        notice: config.notice ?? '',
        maintenance: config.maintenance === '1' || config.maintenance === 'true' ? '1' : '0',
        filmBlur: limit(config.film_blur, 40),
        filmDim: limit(config.film_dim, 100),
        /*
         * Where the Download button goes. Empty means the built-in pipe — the newest GitHub
         * release, streamed by this service with Range support. A value means the owner
         * would rather hand it out from somewhere else (MediaFire, his own CDN, a mirror),
         * and the website sends people straight there: no cold start, no bandwidth, no
         * dependency on this service being awake.
         */
        download: safeLink(config.download),
        /*
         * The brand travels with the config because all three surfaces read this endpoint:
         * the site renders it, the panel renders it, and the loader shows it on the splash
         * and in Settings. A rename therefore reaches an installed copy on its next launch,
         * with no release and no store review.
         */
        brandName: (config.brand_name ?? '').trim() || 'INDRA',
        brandMark: (config.brand_mark ?? '').trim() || (config.brand_name ?? '').trim() || 'INDRA',
        brandTagline: (config.brand_tagline ?? '').trim()
      },
      { headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' } }
    )
  } catch (error) {
    return serverError('loader/config', error)
  }
}
