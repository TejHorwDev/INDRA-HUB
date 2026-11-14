import { currentSession } from '@/lib/auth'
import { readConfig, writeConfig } from '@/lib/db'
import { body, fail, ok, serverError, text } from '@/lib/http'
import { isObjectKey } from '@/lib/storage'
import { objectUrl } from '@/lib/url'

/*
 * POST   /api/admin/appearance  { key }  — set the sign-in film from an upload
 * DELETE /api/admin/appearance           — go back to the animated wash
 *
 * The film is a setting, not a product: one video, on the screen everybody sees
 * before they have signed in. It lives in the same bucket as the installers, under
 * `videos/`, and the row holds an absolute URL the app can actually open.
 */

export async function POST(request: Request): Promise<Response> {
  if (!(await currentSession())) return fail('Not signed in.', 401)

  const payload = await body(request)
  const key = text(payload?.['key'], 400)
  if (!isObjectKey(key) || !key.startsWith('videos/')) return fail('That is not an uploaded video.')

  try {
    const url = objectUrl(request, key)
    await writeConfig({ video: url })
    return ok({ video: url, config: await readConfig() })
  } catch (error) {
    return serverError('admin/appearance:set', error)
  }
}

export async function DELETE(): Promise<Response> {
  if (!(await currentSession())) return fail('Not signed in.', 401)

  try {
    await writeConfig({ video: '' })
    return ok({ config: await readConfig() })
  } catch (error) {
    return serverError('admin/appearance:clear', error)
  }
}
