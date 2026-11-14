import { createHash } from 'node:crypto'
import { currentSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { body, fail, ok, serverError, text } from '@/lib/http'
import { openObject } from '@/lib/storage'

/*
 * POST /api/admin/finalize  { id, key, kind }
 *
 * The step that makes a download verifiable.
 *
 * The panel uploads the bytes and then asks this to hash them where they now live:
 * the object is streamed back through the server, digested, and the size and
 * SHA-256 are written onto the product. Doing it here rather than in the browser
 * means the hash describes the bytes that are actually stored, not the bytes that
 * were meant to be.
 *
 * For a 300 MB installer this is one streamed read. It happens once per upload.
 */
export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  if (!(await currentSession())) return fail('Not signed in.', 401)

  const payload = await body(request)
  const id = text(payload?.['id'], 60)
  const key = text(payload?.['key'], 400)
  const kind = text(payload?.['kind'], 10) || 'exe'

  if (!id || !key) return fail('Nothing to finalise.')

  const stream = await openObject(key)
  if (!stream) return fail('The upload is not in storage. Try it again.', 409)

  try {
    const hash = createHash('sha256')
    let bytes = 0

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        hash.update(chunk)
      })
      stream.on('error', reject)
      stream.on('end', resolve)
    })

    const sha256 = hash.digest('hex')
    const patch: Record<string, unknown> =
      kind === 'image'
        ? { image_url: `/api/files/${key}` }
        : { exe_url: `/api/files/${key}`, exe_sha256: sha256, exe_bytes: bytes }

    const { error } = await db().from('loader_apps').update(patch).eq('id', id)
    if (error) throw new Error(error.message)

    return ok({ sha256, bytes, url: `/api/files/${key}` })
  } catch (error) {
    return serverError('admin/finalize', error)
  }
}
