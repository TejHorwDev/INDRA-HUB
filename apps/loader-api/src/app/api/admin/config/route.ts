import { currentSession } from '@/lib/auth'
import { readConfig, writeConfig } from '@/lib/db'
import { body, fail, ok, serverError } from '@/lib/http'
import { safeLink } from '@/lib/url'

/*
 * GET /api/admin/config — the links.
 * PUT /api/admin/config — replace them.
 *
 * Only known keys are written, so a stray field cannot add a row that the loader
 * will then wonder about.
 */

const KNOWN = [
  'website',
  'video',
  'notice',
  'maintenance',
  'film_blur',
  'film_dim',
  /* Where the Download button points. Empty streams the newest GitHub release. */
  'download'
] as const

export async function GET(): Promise<Response> {
  if (!(await currentSession())) return fail('Not signed in.', 401)
  try {
    return ok({ config: await readConfig() })
  } catch (error) {
    return serverError('admin/config:read', error)
  }
}

export async function PUT(request: Request): Promise<Response> {
  if (!(await currentSession())) return fail('Not signed in.', 401)

  const payload = await body(request)
  if (!payload) return fail('Nothing to save.')

  const values: Record<string, string> = {}
  /* The three keys that end up in an href or a video src. None of them may be `javascript:`. */
  const LINKS = new Set(['website', 'video', 'download'])

  for (const key of KNOWN) {
    const raw = payload[key]
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (LINKS.has(key)) {
        if (trimmed && !safeLink(trimmed)) {
          return fail(`That ${key === 'video' ? 'film' : key === 'download' ? 'download' : 'website'} link is not http(s).`)
        }
        values[key] = trimmed ? safeLink(trimmed) : ''
        continue
      }
      values[key] = trimmed.slice(0, 500)
    }
    /* A flag arrives as a boolean from the panel's switch and is stored as text,
       because the config table has one column and it is text. */
    if (typeof raw === 'boolean') values[key] = raw ? '1' : '0'
  }
  if (Object.keys(values).length === 0) return fail('Nothing to save.')

  try {
    await writeConfig(values)
    return ok({ config: await readConfig() })
  } catch (error) {
    return serverError('admin/config:write', error)
  }
}
