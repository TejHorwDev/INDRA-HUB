import { currentSession } from '@/lib/auth'
import { db, getApp } from '@/lib/db'
import { body, fail, ok, serverError, text } from '@/lib/http'

/*
 * PATCH  /api/admin/apps/:id — change what is published.
 * DELETE /api/admin/apps/:id — remove it from the catalogue.
 *
 * Deleting the row does not delete the installer: a file that a paying customer
 * may already be downloading should not vanish because a listing was removed.
 * The panel says where it is, and the bucket can be tidied up deliberately.
 */

type Params = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  if (!(await currentSession())) return fail('Not signed in.', 401)

  const { id } = await params
  const payload = await body(request)
  if (!payload) return fail('Nothing to change.')

  const patch: Record<string, unknown> = {}

  if ('name' in payload) {
    const name = text(payload['name'], 80)
    if (!name) return fail('A product needs a name.')
    patch.name = name
  }
  if ('description' in payload) patch.description = text(payload['description'], 600)
  if ('version' in payload) patch.version = text(payload['version'], 40) || '1.0.0'
  if ('keyauthAppId' in payload) patch.keyauth_app_id = text(payload['keyauthAppId'], 120)
  if ('status' in payload) patch.status = payload['status'] === 'locked' ? 'locked' : 'active'
  if ('image' in payload) patch.image_url = text(payload['image'], 2000)
  if ('fileUrl' in payload) patch.exe_url = text(payload['fileUrl'], 2000)
  if ('sha256' in payload) patch.exe_sha256 = text(payload['sha256'], 64).toLowerCase()
  if ('bytes' in payload) patch.exe_bytes = Number(payload['bytes']) || 0

  if (Object.keys(patch).length === 0) return fail('Nothing to change.')

  try {
    const { error } = await db().from('apps').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    const row = await getApp(id)
    if (!row) return fail('That product no longer exists.', 404)
    return ok({ app: row })
  } catch (error) {
    return serverError('admin/apps:patch', error)
  }
}

export async function DELETE(_request: Request, { params }: Params): Promise<Response> {
  if (!(await currentSession())) return fail('Not signed in.', 401)

  const { id } = await params
  try {
    const { error } = await db().from('apps').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return ok({ ok: true })
  } catch (error) {
    return serverError('admin/apps:delete', error)
  }
}
