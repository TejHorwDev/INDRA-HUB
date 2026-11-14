import { currentSession } from '@/lib/auth'
import { body, fail, ok, serverError } from '@/lib/http'
import { capFor, driver, formatBytes, probeStorage, storageReady, usageByKind } from '@/lib/storage'
import {
  ensureStorageConfig,
  invalidateStorageConfig,
  maskedStorage,
  saveStorageSettings,
  storageSettings,
  type StoredStorage
} from '@/lib/storage-config'
import { b2Endpoint, env, storageDriverConfigured } from '@/lib/env'

/*
 * GET   /api/admin/storage   — where files go, what is there, and a masked view of the keys
 * POST  /api/admin/storage   — save credentials from the panel
 * PUT   /api/admin/storage   — write a probe object and read it back
 *
 * Storage credentials are the one thing in this app that used to require a redeploy to
 * change, and the one thing a wrong value reports as "upload failed" with no further
 * detail. Now they are set here, tested here, and never sent back to the browser —
 * `maskedStorage()` returns enough of each key to recognise it and not enough to use it.
 */

export async function GET(): Promise<Response> {
  if (!(await currentSession())) return fail('Not signed in.', 401)
  await ensureStorageConfig()

  const settings = storageSettings()
  const usage = await usageByKind()

  return ok({
    driver: driver(),
    reason: settings.reason,
    ready: storageReady(),
    configured: storageDriverConfigured(),
    bucket:
      settings.driver === 'r2'
        ? settings.r2.bucket
        : settings.driver === 'b2'
          ? settings.b2.bucket
          : settings.driver === 'supabase'
            ? settings.supabaseBucket
            : '.data/uploads',
    endpoint: settings.driver === 'b2' ? b2Endpoint() : null,
    region: settings.driver === 'b2' ? settings.b2.region : null,
    caps: { exe: capFor('exe'), image: capFor('image'), video: capFor('video') },
    capsLabel: {
      exe: formatBytes(capFor('exe')),
      image: formatBytes(capFor('image')),
      video: formatBytes(capFor('video'))
    },
    saved: maskedStorage(),
    usage,
    /* The origin that has to appear in the bucket's CORS rule. */
    origin: env.publicBaseUrl || 'https://indra-loader-api.onrender.com'
  })
}

export async function POST(request: Request): Promise<Response> {
  if (!(await currentSession())) return fail('Not signed in.', 401)
  await ensureStorageConfig()

  const payload = await body(request)
  if (!payload) return fail('Nothing to save.')

  try {
    await saveStorageSettings(payload as Partial<StoredStorage>)
    invalidateStorageConfig()
    await ensureStorageConfig(true)
    return ok({ driver: driver(), reason: storageSettings().reason, saved: maskedStorage() })
  } catch (error) {
    return serverError('admin/storage', error)
  }
}

export async function PUT(): Promise<Response> {
  if (!(await currentSession())) return fail('Not signed in.', 401)
  await ensureStorageConfig()

  const result = await probeStorage()
  return ok(result)
}
