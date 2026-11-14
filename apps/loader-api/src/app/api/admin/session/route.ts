import { currentSession } from '@/lib/auth'
import { adminReady, databaseReady } from '@/lib/env'
import { driver, storageReady } from '@/lib/storage'
import { fail, ok } from '@/lib/http'

/*
 * GET /api/admin/session
 *
 * What the panel needs to draw itself honestly: who is signed in, and which parts
 * of the machine are actually wired up.
 */
export async function GET(): Promise<Response> {
  if (!(await currentSession())) return fail('Not signed in.', 401)

  return ok({
    ok: true,
    ready: { database: databaseReady(), storage: storageReady(), admin: adminReady() },
    storage: driver()
  })
}
