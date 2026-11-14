import { currentSession } from '@/lib/auth'
import { db, listApps } from '@/lib/db'
import { body, fail, ok, serverError, text } from '@/lib/http'

/*
 * GET  /api/admin/apps — everything, including locked products.
 * POST /api/admin/apps — create one.
 *
 * A product is created before its file is uploaded: the row is the thing that
 * holds the id, and the upload needs somewhere to land. A draft with no file is
 * therefore normal, and the panel says so rather than pretending.
 */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  if (!(await currentSession())) return fail('Not signed in.', 401)
  try {
    return ok({ apps: await listApps() })
  } catch (error) {
    return serverError('admin/apps:list', error)
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!(await currentSession())) return fail('Not signed in.', 401)

  const payload = await body(request)
  const name = text(payload?.['name'], 80)
  if (!name) return fail('A product needs a name.')

  try {
    const { data, error } = await db()
      .from('apps')
      .insert({
        name,
        description: text(payload?.['description'], 600),
        version: text(payload?.['version'], 40) || '1.0.0',
        keyauth_app_id: text(payload?.['keyauthAppId'], 120),
        status: payload?.['status'] === 'locked' ? 'locked' : 'active'
      })
      .select('id')
      .single()

    if (error) throw new Error(error.message)
    return ok({ id: (data as { id: string }).id }, { status: 201 })
  } catch (error) {
    return serverError('admin/apps:create', error)
  }
}
