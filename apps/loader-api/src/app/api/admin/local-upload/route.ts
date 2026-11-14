import { Readable } from 'node:stream'
import { currentSession } from '@/lib/auth'
import { fail, ok, serverError } from '@/lib/http'
import { driver, isObjectKey, localWrite } from '@/lib/storage'

/*
 * POST /api/admin/local-upload?key=...
 *
 * The development driver's upload endpoint. In a real deployment the browser
 * writes straight to the bucket and this route is never reached — it refuses to
 * run at all unless storage is in local mode.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  if (!(await currentSession())) return fail('Not signed in.', 401)
  if (driver() !== 'local') return fail('Direct upload is only used by the local driver.', 400)

  const key = new URL(request.url).searchParams.get('key') ?? ''
  if (!isObjectKey(key)) return fail('That key is not valid.')

  if (!request.body) return fail('No bytes.')

  try {
    await localWrite(key, Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]))
    return ok({ key })
  } catch (error) {
    return serverError('admin/local-upload', error)
  }
}
