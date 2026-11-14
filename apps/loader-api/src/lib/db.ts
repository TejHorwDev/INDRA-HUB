import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { databaseReady, env } from './env'

/*
 * The database, server-side only.
 *
 * The service role key bypasses row level security, which is exactly why RLS is
 * enabled with no policy: this client is the only thing that can read the tables,
 * and it never leaves the server.
 */

let client: SupabaseClient | null = null

export function db(): SupabaseClient {
  if (!databaseReady()) {
    throw new Error('Database is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  }
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  }
  return client
}

/** The row as it is stored. */
export interface AppRow {
  id: string
  name: string
  description: string
  version: string
  image_url: string
  exe_url: string
  keyauth_app_id: string
  status: 'active' | 'locked'
  exe_sha256: string
  exe_bytes: number
  created_at: string
  updated_at: string
}

/** The same row as the loader reads it. Snake case is a storage detail. */
export interface PublicApp {
  id: string
  name: string
  description: string
  version: string
  image: string
  fileUrl: string
  keyauthAppId: string
  sha256: string
  status: 'active' | 'locked'
}

export function toPublic(row: AppRow): PublicApp {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    version: row.version ?? '1.0.0',
    image: row.image_url ?? '',
    fileUrl: row.exe_url ?? '',
    keyauthAppId: row.keyauth_app_id ?? '',
    sha256: (row.exe_sha256 ?? '').toLowerCase(),
    status: row.status === 'locked' ? 'locked' : 'active'
  }
}

export const APP_COLUMNS =
  'id,name,description,version,image_url,exe_url,keyauth_app_id,status,exe_sha256,exe_bytes,created_at,updated_at'

export async function listApps(): Promise<AppRow[]> {
  const { data, error } = await db().from('apps').select(APP_COLUMNS).order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as AppRow[]
}

export async function getApp(id: string): Promise<AppRow | null> {
  const { data, error } = await db().from('apps').select(APP_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as AppRow | null) ?? null
}

export async function readConfig(): Promise<Record<string, string>> {
  const { data, error } = await db().from('config').select('key,value')
  if (error) throw new Error(error.message)
  const out: Record<string, string> = {}
  for (const row of (data ?? []) as Array<{ key: string; value: string }>) out[row.key] = row.value ?? ''
  return out
}

export async function writeConfig(values: Record<string, string>): Promise<void> {
  const rows = Object.entries(values).map(([key, value]) => ({ key, value }))
  if (rows.length === 0) return
  const { error } = await db().from('config').upsert(rows, { onConflict: 'key' })
  if (error) throw new Error(error.message)
}
