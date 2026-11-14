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

export async function GET(): Promise<Response> {
  if (!databaseReady()) {
    return Response.json({ website: '', video: '' }, { headers: { 'cache-control': 'no-store' } })
  }

  try {
    const config = await readConfig()
    return Response.json(
      { website: config.website ?? '', video: config.video ?? '' },
      { headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' } }
    )
  } catch (error) {
    return serverError('loader/config', error)
  }
}
