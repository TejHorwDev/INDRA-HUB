import { currentSession } from '@/lib/auth'
import { body, fail, ok, serverError, text } from '@/lib/http'
import { createUploadTarget, type Kind } from '@/lib/storage'

/*
 * POST /api/admin/upload-url
 *
 * Hands the browser a URL to PUT bytes at. The installer never passes through this
 * server — that is the whole point of presigning, and it is what makes a 300 MB
 * product possible on a host with 512 MB of memory.
 *
 * The panel computes the SHA-256 while it uploads and reports it afterwards, so
 * the catalogue can publish a hash the loader will check.
 */
export async function POST(request: Request): Promise<Response> {
  if (!(await currentSession())) return fail('Not signed in.', 401)

  const payload = await body(request)
  const kind = text(payload?.['kind'], 10) as Kind
  const filename = text(payload?.['filename'], 200)
  const contentType = text(payload?.['contentType'], 120) || 'application/octet-stream'

  if (kind !== 'exe' && kind !== 'image' && kind !== 'video') {
    return fail('Upload an installer, an image, or a video.')
  }
  if (!filename) return fail('A file needs a name.')

  // The loader will only download an https URL. A local driver exists for
  // development on this same machine, and is refused in production.
  try {
    const target = await createUploadTarget(kind, filename, contentType)
    return ok(target)
  } catch (error) {
    return serverError('admin/upload-url', error)
  }
}
