import type { BackendConfigInput, BackendStatus } from '@shared/types'
import { getDatabase } from '../db/database'
import { errors } from '../lib/errors'

/*
 * Optional Supabase connection.
 *
 * Stage 1 only: the app stores the project URL and the *public* key, and can
 * prove whether the database behind them is reachable and has our schema. No
 * project data leaves the machine yet — that starts once authentication is
 * designed (see docs/SUPABASE.md), because a desktop app holding a key must
 * never be able to write to a table it does not own.
 */

const URL_KEY = 'backend_url'
const ANON_KEY = 'backend_anon_key'
const TIMEOUT_MS = 8_000

interface TestResult {
  reachable: boolean | null
  message: string | null
  checkedAt: string | null
}

let lastTest: TestResult = { reachable: null, message: null, checkedAt: null }

function readValue(key: string): string | null {
  const row = getDatabase().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function writeValue(key: string, value: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, new Date().toISOString())
}

function deleteValue(key: string): void {
  getDatabase().prepare('DELETE FROM app_settings WHERE key = ?').run(key)
}

/** Reads the role claim out of a JWT-shaped Supabase key, if it is one. */
function keyRole(key: string): string | null {
  const parts = key.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as { role?: string }
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

function validateUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '')
  if (!value) throw errors.validation('Enter the Supabase project URL.', 'url')

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw errors.validation('That is not a URL. It looks like https://your-project.supabase.co.', 'url')
  }
  if (parsed.protocol !== 'https:') {
    throw errors.validation('The project URL must start with https://.', 'url')
  }
  // Keep only scheme + host: a pasted path such as /dashboard would break the
  // REST calls that are built from this later.
  return parsed.origin
}

function validateKey(raw: string): string {
  const key = raw.trim()
  if (key.length < 24) {
    throw errors.validation('That does not look like a Supabase key. Copy the anon / public key.', 'key')
  }
  if (key.startsWith('sb_secret_')) {
    throw errors.validation(
      'That is a secret key. It bypasses every security policy, so it must never be stored in the app — use the public key.',
      'key'
    )
  }
  if (keyRole(key) === 'service_role') {
    throw errors.validation(
      'That is the service_role key. It bypasses every security policy, so it must never be stored in the app — use the anon / public key.',
      'key'
    )
  }
  return key
}

function describeFailure(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'The project did not answer within 8 seconds. Check the URL and the connection.'
  }
  return 'Could not reach that project. Check the URL and the connection.'
}

export function backendStatus(): BackendStatus {
  const url = readValue(URL_KEY)
  const key = readValue(ANON_KEY)
  const configured = Boolean(url && key)

  return {
    configured,
    url,
    keyHint: key ? `••••${key.slice(-4)}` : null,
    reachable: configured ? lastTest.reachable : null,
    message: configured
      ? lastTest.message
      : 'No Supabase project is connected. The app keeps working entirely on this machine.',
    checkedAt: configured ? lastTest.checkedAt : null
  }
}

export async function testBackendConnection(): Promise<BackendStatus> {
  const url = readValue(URL_KEY)
  const key = readValue(ANON_KEY)
  if (!url || !key) return backendStatus()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const headers = { apikey: key, Authorization: `Bearer ${key}` }

  try {
    const root = await fetch(`${url}/rest/v1/`, { headers, signal: controller.signal })
    if (root.status === 401 || root.status === 403) {
      lastTest = {
        reachable: false,
        message: 'Supabase rejected that key. Re-copy the anon / public key from Project Settings → API.',
        checkedAt: new Date().toISOString()
      }
      return backendStatus()
    }
    if (!root.ok && root.status !== 404) {
      lastTest = {
        reachable: false,
        message: `Supabase answered with HTTP ${root.status}.`,
        checkedAt: new Date().toISOString()
      }
      return backendStatus()
    }

    // Is our schema actually there? PostgREST answers 404 for a missing table;
    // an empty 200 means the table exists but RLS is hiding every row, which is
    // exactly what schema.sql sets up.
    const schema = await fetch(`${url}/rest/v1/indra_projects?select=id&limit=1`, {
      headers,
      signal: controller.signal
    })

    if (schema.status === 404) {
      lastTest = {
        reachable: true,
        message:
          'Connected, but the tables are missing. Run supabase/schema.sql in the Supabase SQL editor (see docs/SUPABASE.md).',
        checkedAt: new Date().toISOString()
      }
      return backendStatus()
    }

    lastTest = schema.ok
      ? {
          reachable: true,
          message:
            'Connected — the schema is in place. Tables stay sealed until sign-in is handled by Supabase (Stage 2).',
          checkedAt: new Date().toISOString()
        }
      : {
          reachable: true,
          message: `Connected, but the schema check answered HTTP ${schema.status}.`,
          checkedAt: new Date().toISOString()
        }

    return backendStatus()
  } catch (error) {
    lastTest = {
      reachable: false,
      message: describeFailure(error),
      checkedAt: new Date().toISOString()
    }
    return backendStatus()
  } finally {
    clearTimeout(timer)
  }
}

export async function saveBackendConfig(input: BackendConfigInput): Promise<BackendStatus> {
  const url = validateUrl(input?.url ?? '')
  const key = validateKey(input?.key ?? '')

  writeValue(URL_KEY, url)
  writeValue(ANON_KEY, key)
  lastTest = { reachable: null, message: null, checkedAt: null }

  // Save then immediately prove it, so the panel never shows a stored config
  // that has never worked.
  return testBackendConnection()
}

export function clearBackendConfig(): BackendStatus {
  deleteValue(URL_KEY)
  deleteValue(ANON_KEY)
  lastTest = { reachable: null, message: null, checkedAt: null }
  return backendStatus()
}
