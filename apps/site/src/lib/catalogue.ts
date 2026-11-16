/*
 * What the site knows about the catalogue.
 *
 * The desktop app and this page read the same two public endpoints, so there is exactly
 * one place a product is published and exactly one answer about what is live. The panel
 * is the source; this is a view of it.
 *
 * Both reads are allowed to fail. A marketing page that throws because a free-tier API
 * is asleep is a page nobody can buy anything from — so a failed read is an empty
 * catalogue and a version that says so, not an error screen.
 */

/** The API that already serves the loader. Overridable for a staging deploy. */
/**
 * This site's own address, used for canonical links and the sitemap. Only wrong in a
 * preview, and a preview is not what search engines read.
 */
export const SITE_URL = (process.env['SITE_URL'] ?? 'https://indra-site.onrender.com').replace(/\/+$/, '')


const API = (process.env['INDRA_API'] ?? 'https://indra-loader-api.onrender.com').replace(/\/+$/, '')

export interface Product {
  id: string
  /** A readable address for the product's page: STREAMER MAX lives at /p/streamer-max. */
  slug: string
  name: string
  description: string
  version: string
  image: string
  artworkBlur: number
  artworkDim: number
  status: 'active' | 'locked'
}

export interface SiteConfig {
  website: string
  video: string
  notice: string
  maintenance: boolean
}

interface RawApp {
  id?: unknown
  name?: unknown
  description?: unknown
  version?: unknown
  image?: unknown
  artworkBlur?: unknown
  artworkDim?: unknown
  status?: unknown
}

/**
 * A product name as a link.
 *
 * The ids in the panel are UUIDs, which nobody should have to read or share. The name is
 * already unique in practice, so it becomes the address — and the id stays the fallback
 * for anything that was linked before a product was renamed.
 */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** Every field is normalised here, so the page never has to think about a missing one. */
function toProduct(raw: RawApp): Product | null {
  const id = typeof raw.id === 'string' ? raw.id : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!id || !name) return null

  return {
    id,
    slug: slug(name) || id,
    name,
    description: typeof raw.description === 'string' ? raw.description : '',
    version: typeof raw.version === 'string' && raw.version ? raw.version : '1.0.0',
    image: typeof raw.image === 'string' ? raw.image : '',
    artworkBlur: typeof raw.artworkBlur === 'number' ? raw.artworkBlur : 0,
    artworkDim: typeof raw.artworkDim === 'number' ? raw.artworkDim : 0,
    status: raw.status === 'locked' ? 'locked' : 'active'
  }
}

async function read<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${API}${path}`, {
      // A minute of cache: fast for everyone, and a product added in the panel is on the
      // site before anybody could complain that it is not.
      next: { revalidate: 60 },
      /*
       * Nine seconds, then give up.
       *
       * The API is a free-tier service that sleeps, and the first request after it wakes
       * can take half a minute. A visitor must not wait for that: the page renders from
       * the cache with whatever it has, and the next regeneration picks the catalogue up.
       */
      signal: AbortSignal.timeout(9_000)
    })
    if (!response.ok) return fallback
    return (await response.json()) as T
  } catch {
    return fallback
  }
}

/*
 * A stand-in catalogue for looking at the design without a deployment.
 *
 *   INDRA_SITE_DEMO=1 npm run dev
 *
 * Only reached when that variable is set, and never on the deployed service — the real
 * page has no idea this exists. It exists because "does the grid look right with four
 * cards in it" should not require a live database and a push to main.
 */
function demoProducts(): Product[] {
  return ['External Max', 'Internal Max', 'Streamer Max', 'FPS Booster'].map((name, index) => ({
    id: `demo-${index}`,
    slug: slug(name),
    name,
    description: '',
    version: '1.0.0',
    image: '',
    artworkBlur: 0,
    artworkDim: 0,
    status: 'active'
  }))
}

export async function getProducts(): Promise<Product[]> {
  const body = await read<{ apps?: RawApp[] }>('/api/loader/apps', {})
  const apps = Array.isArray(body.apps) ? body.apps : []
  const products = apps.map(toProduct).filter((product): product is Product => product !== null)
  if (products.length === 0 && process.env['INDRA_SITE_DEMO'] === '1') return demoProducts()
  return products
}

/**
 * One product, by id.
 *
 * Read from the same list the grid is built from rather than a second endpoint, so a card
 * and the page it opens can never disagree about a version.
 */
export async function getProduct(handle: string): Promise<Product | null> {
  const products = await getProducts()
  const key = handle.toLowerCase()
  return products.find((product) => product.slug === key) ?? products.find((product) => product.id === handle) ?? null
}

export async function getConfig(): Promise<SiteConfig> {
  const body = await read<Record<string, unknown>>('/api/loader/config', {})
  return {
    website: typeof body['website'] === 'string' ? body['website'] : '',
    video: typeof body['video'] === 'string' ? body['video'] : '',
    notice: typeof body['notice'] === 'string' ? body['notice'] : '',
    maintenance: body['maintenance'] === true || body['maintenance'] === '1' || body['maintenance'] === 'true'
  }
}

/** The newest published loader, read from the panel so the site does not touch GitHub. */
export async function getLoader(): Promise<{ version: string | null; bytes: number | null }> {
  // The update feed answers with a nested object — the same one the desktop app adopts.
  const body = await read<{ update?: { version?: unknown; size?: unknown } | null }>(
    '/api/loader/update',
    {}
  )
  const update = body.update ?? null
  const version = update && typeof update.version === 'string' && update.version ? update.version : null
  const bytes = update && typeof update.size === 'number' && update.size > 0 ? update.size : null
  return { version, bytes }
}

/** Every download is this one URL: the panel streams the installer and passes Range through. */
export const INSTALLER_URL = `${API}/api/loader/installer`

export function size(bytes: number | null): string {
  if (!bytes) return ''
  const mb = bytes / 1048576
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}
