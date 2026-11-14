import { readConfig, writeConfig } from './db'
import { databaseReady, env } from './env'

/*
 * Where the bucket is, decided in the panel instead of in a dashboard.
 *
 * Storage credentials used to be environment variables only, which made every change a
 * redeploy and every mistake a wait. The panel is supposed to be able to do everything,
 * so these live in the database now — written once from Settings → Storage, read by
 * every route through this file.
 *
 * Three rules keep it honest:
 *
 *  - The value is never sent back to a browser. The panel reads a *masked* version and
 *    writes whole ones; nothing in this file hands out a secret.
 *  - Environment variables still win where they are set explicitly. A deployment that
 *    has `STORAGE_DRIVER` pinned should not be silently overridden by a stale row.
 *  - A driver whose credentials are incomplete is not a driver. `auto` resolves to the
 *    first one that could actually work, so a half-filled form falls back to something
 *    that uploads rather than to something that throws.
 */

export type Driver = 'r2' | 'b2' | 'supabase' | 'local'
export type DriverChoice = Driver | 'auto'

export interface StoredStorage {
  driver: DriverChoice
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }
  b2: { keyId: string; applicationKey: string; bucket: string; region: string }
  updatedAt: string | null
}

export const CONFIG_KEY = 'storage'

const BLANK: StoredStorage = {
  driver: 'auto',
  r2: { accountId: '', accessKeyId: '', secretAccessKey: '', bucket: '' },
  b2: { keyId: '', applicationKey: '', bucket: '', region: '' },
  updatedAt: null
}

/** The row, as stored. Read through the service role, so RLS keeps it server-side. */
let cache: StoredStorage = BLANK
let loadedAt = 0
let loading: Promise<void> | null = null
/** Long enough to save a round trip per request, short enough to feel immediate. */
const TTL_MS = 30_000

function parse(raw: string | undefined): StoredStorage {
  if (!raw) return BLANK
  try {
    const parsed = JSON.parse(raw) as Partial<StoredStorage>
    const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
    return {
      driver:
        parsed.driver === 'r2' || parsed.driver === 'b2' || parsed.driver === 'supabase' || parsed.driver === 'local'
          ? parsed.driver
          : 'auto',
      r2: {
        accountId: text(parsed.r2?.accountId),
        accessKeyId: text(parsed.r2?.accessKeyId),
        secretAccessKey: text(parsed.r2?.secretAccessKey),
        bucket: text(parsed.r2?.bucket)
      },
      b2: {
        keyId: text(parsed.b2?.keyId),
        applicationKey: text(parsed.b2?.applicationKey),
        bucket: text(parsed.b2?.bucket),
        region: text(parsed.b2?.region) || 'us-west-004'
      },
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null
    }
  } catch {
    return BLANK
  }
}

/**
 * Reads the row once per process, then once every thirty seconds.
 *
 * Every entry point that touches storage awaits this first — six of them — rather than
 * each route deciding for itself whether the cache is warm.
 */
export function ensureStorageConfig(force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < TTL_MS) return Promise.resolve()
  if (loading) return loading
  loading = (async () => {
    if (!databaseReady()) {
      cache = BLANK
      loadedAt = Date.now()
      return
    }
    try {
      const config = await readConfig()
      cache = parse(config[CONFIG_KEY])
    } catch {
      /* A database that cannot be read leaves the environment in charge. */
      cache = BLANK
    }
    loadedAt = Date.now()
  })().finally(() => {
    loading = null
  })
  return loading
}

export function invalidateStorageConfig(): void {
  loadedAt = 0
}

export function storedStorage(): StoredStorage {
  return cache
}

function own(record: Record<string, string>): boolean {
  return Boolean(record && Object.values(record).every((value) => value !== ''))
}

function storedDriverWorks(stored: StoredStorage): boolean {
  if (stored.driver === 'supabase') return Boolean(env.supabaseUrl && env.supabaseServiceKey)
  if (stored.driver === 'r2') return own(stored.r2 as unknown as Record<string, string>)
  if (stored.driver === 'b2') return Boolean(stored.b2.keyId && stored.b2.applicationKey && stored.b2.bucket)
  return stored.driver === 'local'
}

/** Everything the storage layer needs, resolved and complete. */
export interface StorageSettings {
  driver: Driver
  /** Why this driver, in a few words — shown in the panel. */
  reason: string
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }
  b2: { keyId: string; applicationKey: string; bucket: string; region: string; endpoint: string }
  supabaseBucket: string
}

export function storageSettings(): StorageSettings {
  const b2Region = cache.b2.region || env.b2.region
  const r2 = cache.r2.accountId || cache.r2.accessKeyId ? cache.r2 : env.r2
  const b2 = cache.b2.keyId || cache.b2.applicationKey ? { ...cache.b2, region: b2Region } : env.b2

  const r2Complete = Boolean(r2.accountId && r2.accessKeyId && r2.secretAccessKey && r2.bucket)
  const b2Complete = Boolean(b2.keyId && b2.applicationKey && b2.bucket)
  const supabaseComplete = Boolean(env.supabaseUrl && env.supabaseServiceKey)

  let driver: Driver = 'local'
  let reason = 'no credentials anywhere: uploads land on local disk'

  if (storedDriverWorks(cache)) {
    driver = cache.driver as Driver
    reason = 'set in the panel'
  } else if (env.storageDriver === 'r2' || env.storageDriver === 'b2' || env.storageDriver === 'supabase' || env.storageDriver === 'local') {
    driver = env.storageDriver as Driver
    reason = 'pinned by STORAGE_DRIVER'
  } else if (r2Complete) {
    driver = 'r2'
    reason = 'R2 credentials found'
  } else if (b2Complete) {
    driver = 'b2'
    reason = 'B2 credentials found'
  } else if (supabaseComplete) {
    driver = 'supabase'
    reason = 'Supabase is the only bucket configured'
  }

  return {
    driver,
    reason,
    r2: { ...r2, bucket: r2.bucket },
    b2: {
      keyId: b2.keyId,
      applicationKey: b2.applicationKey,
      bucket: b2.bucket,
      region: b2.region,
      endpoint: (env.b2.endpoint || `https://s3.${b2.region}.backblazeb2.com`).replace(/\/+$/, '')
    },
    supabaseBucket: env.supabaseBucket
  }
}

/** What the panel may see: enough to recognise a value, never enough to use one. */
export interface MaskedStorage {
  driver: DriverChoice
  updatedAt: string | null
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }
  b2: { keyId: string; applicationKey: string; bucket: string; region: string }
}

function mask(secret: string): string {
  if (!secret) return ''
  if (secret.length <= 8) return '•'.repeat(secret.length)
  return `${secret.slice(0, 4)}${'•'.repeat(Math.min(16, secret.length - 8))}${secret.slice(-4)}`
}

export function maskedStorage(): MaskedStorage {
  return {
    driver: cache.driver,
    updatedAt: cache.updatedAt,
    r2: {
      accountId: mask(cache.r2.accountId),
      accessKeyId: mask(cache.r2.accessKeyId),
      secretAccessKey: mask(cache.r2.secretAccessKey),
      bucket: cache.r2.bucket
    },
    b2: {
      keyId: mask(cache.b2.keyId),
      applicationKey: mask(cache.b2.applicationKey),
      bucket: cache.b2.bucket,
      region: cache.b2.region
    }
  }
}

/**
 * Saves what was typed, and only what was typed.
 *
 * An empty field means "leave it alone", not "delete it" — because the form cannot show
 * the current secret, so an untouched box arrives empty and must not wipe a working key.
 * Clearing a field for good is done by choosing a different driver.
 */
export async function saveStorageSettings(input: Partial<StoredStorage>): Promise<StoredStorage> {
  const text = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value.trim() ? value.trim() : fallback

  const next: StoredStorage = {
    driver:
      input.driver === 'r2' || input.driver === 'b2' || input.driver === 'supabase' || input.driver === 'local'
        ? input.driver
        : 'auto',
    r2: {
      accountId: text(input.r2?.accountId, cache.r2.accountId),
      accessKeyId: text(input.r2?.accessKeyId, cache.r2.accessKeyId),
      secretAccessKey: text(input.r2?.secretAccessKey, cache.r2.secretAccessKey),
      bucket: text(input.r2?.bucket, cache.r2.bucket)
    },
    b2: {
      keyId: text(input.b2?.keyId, cache.b2.keyId),
      applicationKey: text(input.b2?.applicationKey, cache.b2.applicationKey),
      bucket: text(input.b2?.bucket, cache.b2.bucket),
      region: text(input.b2?.region, cache.b2.region || 'us-west-004')
    },
    updatedAt: new Date().toISOString()
  }

  await writeConfig({ [CONFIG_KEY]: JSON.stringify(next) })
  cache = next
  loadedAt = Date.now()
  return next
}
