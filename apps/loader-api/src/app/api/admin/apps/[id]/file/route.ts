import { currentSession } from '@/lib/auth'
import { db, getApp } from '@/lib/db'
import { fail, ok, serverError } from '@/lib/http'
import { removeObject } from '@/lib/storage'
import { ensureStorageConfig } from '@/lib/storage-config'
import { keyFromUrl } from '@/lib/url'

/*
 * DELETE /api/admin/apps/:id/file?kind=exe|image — remove a stored file, and the claim
 * that it exists.
 *
 * Two things happen together, and both of them matter:
 *
 *  - the object is deleted from the bucket, so the bytes stop costing storage and stop
 *    being downloadable;
 *  - the product stops pointing at it, so the panel stops claiming an installer is
 *    there. A row that still carries a dead URL is how "I deleted it in Supabase and the
 *    panel still shows an exe" happens — the file was never the source of truth.
 *
 * A URL that is not ours (a GitHub release asset, a link somebody pasted) is not deleted;
 * only the reference is cleared. This endpoint never reaches outside the bucket.
 */
export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  if (!(await currentSession())) return fail('Not signed in.', 401)
  await ensureStorageConfig()

  const { id } = await params
  const kind = new URL(request.url).searchParams.get('kind') === 'image' ? 'image' : 'exe'

  try {
    const row = await getApp(id)
    if (!row) return fail('That product no longer exists.', 404)

    const url = kind === 'image' ? row.image_url : row.exe_url
    const key = keyFromUrl(url)
    let deleted = false

    if (key) {
      try {
        await removeObject(key)
        deleted = true
      } catch (error) {
        /*
         * The object may already be gone — deleted in the Supabase console, which is
         * exactly the case this endpoint is most often asked to tidy up. The row is
         * still cleared: an unreachable file and a missing file are the same fact.
         */
        console.warn('[admin/apps:file] could not delete', key, error)
      }
    }

    const patch: Record<string, unknown> =
      kind === 'image'
        ? { image_url: '' }
        : { exe_url: '', exe_sha256: '', exe_bytes: 0 }

    const { error } = await db().from('loader_apps').update(patch).eq('id', id)
    if (error) throw new Error(error.message)

    const updated = await getApp(id)
    return ok({ app: updated, deleted, key })
  } catch (error) {
    return serverError('admin/apps:delete-file', error)
  }
}
