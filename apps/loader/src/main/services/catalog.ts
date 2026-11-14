import type { Catalogue, LoaderApp, LoaderConfig } from '@shared/types'

/*
 * The catalogue client.
 *
 * Reads the public endpoints and normalises them, so the renderer never has to
 * think about a missing field. Both endpoints must answer 200 with a usable body;
 * anything else is an empty catalogue rather than an error screen, because a
 * dashboard that cannot load is indistinguishable from an account with no apps
 * and both should look calm.
 */

/*
 * Where the catalogue lives.
 *
 * `__LOADER_API__` is replaced at build time (see `electron.vite.config.ts`), so a
 * released installer carries the address inside it. A runtime environment variable
 * still works for development, where nobody wants to rebuild to change a URL.
 */
declare const __LOADER_API__: string

const API_BASE = (
  typeof __LOADER_API__ === 'string' && __LOADER_API__ ? __LOADER_API__ : (process.env['INDRA_LOADER_API'] ?? '')
).replace(/\/+$/, '')

/** Where this service lives. The updater asks it before it asks GitHub. */
export function apiBase(): string {
  return API_BASE
}

const EMPTY_CONFIG: LoaderConfig = { website: '', video: '', notice: '', maintenance: false }

/** The text-valued settings. `maintenance` is parsed separately — it is a flag. */
const FIELDS: Array<'website' | 'video' | 'notice'> = ['website', 'video', 'notice']

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toApp(raw: unknown): LoaderApp | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const id = text(record['id'])
  const name = text(record['name'])
  if (!id || !name) return null

  return {
    id,
    name,
    description: text(record['description']),
    version: text(record['version']) || '1.0.0',
    image: text(record['image']),
    fileUrl: text(record['fileUrl']),
    keyauthAppId: text(record['keyauthAppId']),
    sha256: text(record['sha256']).toLowerCase(),
    status: record['status'] === 'locked' ? 'locked' : 'active'
  }
}

async function get(path: string, timeoutMs = 12_000): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' }
    })
    if (!response.ok) return null
    return (await response.json()) as unknown
  } catch (error) {
    console.warn('[catalog] request failed', path, error instanceof Error ? error.message : error)
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function loadCatalogue(): Promise<Catalogue> {
  /*
   * Until the API is deployed there is no base URL. An empty catalogue is the
   * honest answer, and it is the same shape the dashboard already handles — no
   * placeholder cards, no demo rows.
   */
  if (!API_BASE) return { apps: [], config: { ...EMPTY_CONFIG } }

  // Both calls in parallel, and either one failing must not take the other down.
  const [appsBody, configBody] = await Promise.all([
    get('/api/loader/apps'),
    get('/api/loader/config')
  ])

  const list = (appsBody as { apps?: unknown } | null)?.apps
  const apps = Array.isArray(list)
    ? list.map(toApp).filter((app): app is LoaderApp => app !== null)
    : []

  return { apps, config: toConfig(configBody) }
}

/** The published settings, normalised. Also used on its own by the launch card. */
export function toConfig(body: unknown): LoaderConfig {
  const config: LoaderConfig = { ...EMPTY_CONFIG }
  if (!body || typeof body !== 'object') return config

  const record = body as Record<string, unknown>
  for (const field of FIELDS) config[field] = text(record[field])
  /*
   * Maintenance is written by the panel as '1' or '0' — a string, because the
   * config table has one column and it is text. `true` is accepted too, since a
   * hand-written row is a reasonable thing for an operator to leave behind.
   */
  const flag = record['maintenance']
  config.maintenance = flag === true || flag === '1' || flag === 'true'

  return config
}

/** Just the settings, for callers that do not need the catalogue. */
export async function readConfig(timeoutMs?: number): Promise<LoaderConfig> {
  if (!API_BASE) return { ...EMPTY_CONFIG }
  return toConfig(await get('/api/loader/config', timeoutMs))
}
