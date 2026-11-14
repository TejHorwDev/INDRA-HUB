import { currentSession } from '@/lib/auth'
import { readConfig, writeConfig } from '@/lib/db'
import { body, fail, ok, serverError } from '@/lib/http'

/*
 * GET /api/admin/config — the links.
 * PUT /api/admin/config — replace them.
 *
 * Only known keys are written, so a stray field cannot add a row that the loader
 * will then wonder about.
 */

const KNOWN = ['website', 'video'] as const

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
  for (const key of KNOWN) {
    const raw = payload[key]
    if (typeof raw === 'string') values[key] = raw.trim().slice(0, 500)
  }
  if (Object.keys(values).length === 0) return fail('Nothing to save.')

  try {
    await writeConfig(values)
    return ok({ config: await readConfig() })
  } catch (error) {
    return serverError('admin/config:write', error)
  }
}
