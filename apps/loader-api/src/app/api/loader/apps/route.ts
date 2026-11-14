import { databaseReady } from '@/lib/env'
import { listApps, toPublic } from '@/lib/db'
import { serverError } from '@/lib/http'

/*
 * GET /api/loader/apps
 *
 * The catalogue, for the desktop app. Public, cacheable for a moment, and it
 * never fails: a database that is down answers with an empty list rather than a
 * 500, because the loader treats both the same way and one of them is louder.
 *
 * Locked products are still listed. Hiding them would make the library shrink
 * silently when something is switched off; showing them locked is the honest
 * version and the card already knows how to draw it.
 */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  if (!databaseReady()) {
    return Response.json({ apps: [], version: 1 }, { headers: { 'cache-control': 'no-store' } })
  }

  try {
    const apps = (await listApps()).map(toPublic)
    return Response.json(
      { apps, version: 1 },
      { headers: { 'cache-control': 'public, max-age=30, stale-while-revalidate=120' } }
    )
  } catch (error) {
    return serverError('loader/apps', error)
  }
}
