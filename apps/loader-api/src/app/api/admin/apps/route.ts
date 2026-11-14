import { currentSession } from '@/lib/auth'
import { db, listApps } from '@/lib/db'
import { keySet } from '@/lib/storage'
import { ensureStorageConfig } from '@/lib/storage-config'
import { keyFromUrl } from '@/lib/url'
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
  await ensureStorageConfig()
  try {
    const rows = await listApps()
    return ok({ apps: await withFileTruth(rows) })
  } catch (error) {
    return serverError('admin/apps:list', error)
  }
}

/**
 * Every row, told whether its file is actually still in the bucket.
 *
 * The column stores an address, not a fact. Deleting the object in the Supabase console
 * — which is what anybody does when the panel has no delete button — leaves the address
 * pointing at nothing, and a table that reads the address alone goes on reporting an
 * installer that cannot be downloaded. The two folder listings below are the fact, and
 * they cost two requests however many products there are.
 *
 * A failure to list is not evidence of absence: if the bucket cannot be reached, every
 * file is reported as present rather than the panel crying wolf about all of them.
 */
async function withFileTruth<T extends { exe_url: string; image_url: string }>(
  rows: T[]
): Promise<(T & { exe_missing: boolean; image_missing: boolean })[]> {
  const [exes, images] = await Promise.all([
    keySet('exe').catch(() => null),
    keySet('image').catch(() => null)
  ])

  return rows.map((row) => {
    const exeKey = keyFromUrl(row.exe_url)
    const imageKey = keyFromUrl(row.image_url)
    return {
      ...row,
      exe_missing: Boolean(row.exe_url) && exes !== null && exeKey !== null && !exes.has(exeKey),
      image_missing:
        Boolean(row.image_url) && images !== null && imageKey !== null && !images.has(imageKey)
    }
  })
}

export async function POST(request: Request): Promise<Response> {
  if (!(await currentSession())) return fail('Not signed in.', 401)

  const payload = await body(request)
  const name = text(payload?.['name'], 80)
  if (!name) return fail('A product needs a name.')

  try {
    const { data, error } = await db()
      .from('loader_apps')
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
