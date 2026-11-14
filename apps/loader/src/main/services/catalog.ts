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

const API_BASE = (process.env['INDRA_LOADER_API'] ?? '').replace(/\/+$/, '')

const EMPTY_CONFIG: LoaderConfig = { website: '' }

const FIELDS: Array<keyof LoaderConfig> = ['website']

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

  const config = { ...EMPTY_CONFIG }
  if (configBody && typeof configBody === 'object') {
    const record = configBody as Record<string, unknown>
    for (const field of FIELDS) config[field] = text(record[field])
  }

  return { apps, config }
}
