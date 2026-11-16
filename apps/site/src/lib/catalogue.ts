/*
 * What the site knows about the catalogue.
 *
 * The panel is the only source. Every product, every version, every piece of artwork and
 * every download link on this site comes from the same endpoints the desktop app reads,
 * so publishing something in the panel publishes it here.
 *
 * Nothing here is allowed to throw. A front page that dies because a free-tier API is
 * asleep is a page nobody can install anything from: a failed read is an empty catalogue,
 * a retry, and a page that still works.
 */

/** The API that already serves the loader. Overridable for a staging deploy. */
const API = (process.env['INDRA_API'] ?? 'https://indra-loader-api.onrender.com').replace(/\/+$/, '')

/**
 * This site's own address, for canonical links and the sitemap.
 */
export const SITE_URL = (process.env['SITE_URL'] ?? 'https://indra-site.onrender.com').replace(/\/+$/, '')

export interface Product {
  id: string
  /** A readable address for the product's page: STREAMER MAX lives at /p/streamer-max. */
  slug: string
  name: string
  description: string
  /** The description's opening claim, and the features it lists after it. */
  tagline: string
  features: string[]
  version: string
  image: string
  /** True when the published artwork is a clip rather than a still. */
  imageIsVideo: boolean
  artworkBlur: number
  artworkDim: number
  status: 'active' | 'locked'
}

export interface SiteConfig {
  website: string
  /** The backdrop film, published in the panel. Empty when the panel has none. */
  video: string
  notice: string
  maintenance: boolean
  /** 0–100, from the panel: how hard the film is dimmed and blurred. */
  filmDim: number
  filmBlur: number
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

/**
 * The panel accepts artwork as an image or as a clip — most of what is published there is
 * a .webm or .mp4 of the product running. A still is an <img>; a clip is a looping
 * <video>. Getting this wrong is the difference between a catalogue and four empty boxes.
 */
export function isVideo(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url)
}

/**
 * A description is written the way a person writes a line of copy: a claim, a dash, then
 * what it actually does. Split it once, here, so the page can set the claim large and the
 * features as a list.
 */
function split(description: string): { tagline: string; features: string[] } {
  const parts = description
    .split(/\s+[-–—]\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length <= 1) return { tagline: description.trim(), features: [] }
  return { tagline: parts[0], features: parts.slice(1) }
}

/** Every field is normalised here, so the page never has to think about a missing one. */
function toProduct(raw: RawApp): Product | null {
  const id = typeof raw.id === 'string' ? raw.id : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!id || !name) return null

  const description = typeof raw.description === 'string' ? raw.description.trim() : ''
  const image = typeof raw.image === 'string' ? raw.image : ''
  const { tagline, features } = split(description)

  return {
    id,
    slug: slug(name) || id,
    name,
    description,
    tagline,
    features,
    version: typeof raw.version === 'string' && raw.version ? raw.version : '1.0.0',
    image,
    imageIsVideo: isVideo(image),
    artworkBlur: typeof raw.artworkBlur === 'number' ? raw.artworkBlur : 0,
    artworkDim: typeof raw.artworkDim === 'number' ? raw.artworkDim : 0,
    status: raw.status === 'locked' ? 'locked' : 'active'
  }
}

async function once<T>(path: string, fallback: T, timeoutMs = 25_000): Promise<T> {
  try {
    const response = await fetch(`${API}${path}`, {
      /*
       * Ten seconds, not a minute.
       *
       * This is the whole of "is the site connected to the panel": a product locked, a
       * build re-uploaded, a new loader shipped — all of it is visible on the public site
       * within ten seconds of the panel writing it, with no deploy and no cache to clear.
       */
      next: { revalidate: 10 },
      /*
       * Twenty-five seconds by default, then give up.
       *
       * The API is a free-tier service that sleeps, and the first request after it wakes
       * can take half an hour's worth of patience. A front page that times out at nine
       * seconds renders "nothing is published" — which is exactly how a catalogue of four
       * products ends up looking like an empty page.
       */
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!response.ok) return fallback

    /*
     * Only ever parse JSON.
     *
     * `?probe=1` is the one read that must not be trusted blindly: an older panel that does
     * not know the parameter answers with the installer itself, and a build that swallowed a
     * 116 MB executable into memory before failing would be the most expensive way to learn
     * that. The body is dropped instead, and the page prints no size — which is the honest
     * answer when the panel cannot measure the file.
     */
    if (!(response.headers.get('content-type') ?? '').includes('json')) {
      await response.body?.cancel()
      return fallback
    }

    return (await response.json()) as T
  } catch {
    return fallback
  }
}

/** One retry: a sleeping API usually answers on the second knock. */
async function read<T>(path: string, fallback: T): Promise<T> {
  const first = await once(path, fallback)
  if (first !== fallback) return first
  return once(path, fallback)
}

/*
 * A stand-in catalogue for looking at the design without a deployment.
 *
 *   INDRA_SITE_DEMO=1 npm run dev
 *
 * Only reached when that variable is set, and never on the deployed service.
 */
function demoProducts(): Product[] {
  const rows: Array<[string, string]> = [
    ['External Max', 'Best external cheats in the market - aimbot (external, AI, rage) - ESP menu - skin changer'],
    ['INTERNAL MAX', 'Best internal cheats in the market - aimbot (AI, silent, rage) - full ESP - skin changer'],
    ['STREAMER MAX', 'Best streamer cheats in the market - aimbot (AI, rage) - streamer ESP - invisible on OBS, Discord and Medal'],
    ['FPS BOOSTER', 'More frames on the same hardware - process priority - GPU scheduling - one click']
  ]

  return rows.map(([name, description], index) => {
    const { tagline, features } = split(description)
    return {
      id: `demo-${index}`,
      slug: slug(name),
      name,
      description,
      tagline,
      features,
      version: '1.0.0',
      image: '',
      imageIsVideo: false,
      artworkBlur: 0,
      artworkDim: 0,
      status: index === 1 ? 'locked' : 'active'
    }
  })
}

export async function getProducts(): Promise<Product[]> {
  const body = await read<{ apps?: RawApp[] }>('/api/loader/apps', {})
  const apps = Array.isArray(body.apps) ? body.apps : []
  const products = apps.map(toProduct).filter((product): product is Product => product !== null)
  if (products.length === 0 && process.env['INDRA_SITE_DEMO'] === '1') return demoProducts()
  return products
}

/**
 * One product, by address or by id.
 *
 * Read from the same list the grid is built from rather than a second endpoint, so a card
 * and the page it opens can never disagree about a version.
 */
export async function getProduct(handle: string): Promise<Product | null> {
  const products = await getProducts()
  const key = handle.toLowerCase()
  return products.find((product) => product.slug === key) ?? products.find((product) => product.id === handle) ?? null
}

function count(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 0
}

export async function getConfig(): Promise<SiteConfig> {
  const body = await read<Record<string, unknown>>('/api/loader/config', {})
  return {
    website: typeof body['website'] === 'string' ? body['website'] : '',
    video: typeof body['video'] === 'string' ? body['video'] : '',
    notice: typeof body['notice'] === 'string' ? body['notice'] : '',
    maintenance: body['maintenance'] === true || body['maintenance'] === '1' || body['maintenance'] === 'true',
    filmDim: count(body['filmDim']),
    filmBlur: count(body['filmBlur'])
  }
}

/** The proxy every download goes through. The panel streams the installer and passes Range. */
export const INSTALLER_URL = `${API}/api/loader/installer`

/** Where the panel lives, so the page can open a connection to it before anyone clicks. */
export const API_ORIGIN = API

/**
 * What the Download button is going to hand over.
 *
 * Three things were wrong with asking the update feed for this. The update feed describes
 * the *payload* — the 400 KB `.asar` the installed loader swaps in when it updates itself —
 * so the site was printing "0.4 MB" next to a 116 MB installer, which reads as a fake
 * download. It is cached for a minute inside the panel. And it never checks that the file
 * is actually there.
 *
 * So the number on the page now comes from the download itself: `?probe=1` resolves the
 * newest release exactly the way a real click does, asks GitHub for the first byte of the
 * file, and answers with the asset's name, its true size, and whether it is reachable. The
 * page repeats only what that check returned, which is why the version under "Download"
 * and the file you get are the same build by construction.
 */
interface InstallerProbe {
  version?: unknown
  name?: unknown
  bytes?: unknown
  reachable?: unknown
}

export interface Loader {
  /** The newest published build — the version the download actually delivers. */
  version: string | null
  /** The installer's real size. Null when it could not be verified; the page then says nothing. */
  bytes: number | null
  /** The file you get, e.g. `INDRA-LOADER-Setup-1.0.52.exe`. */
  name: string | null
  /** True when the pipe answered with a file that exists. */
  verified: boolean
  /**
   * The address the button points at, carrying the version.
   *
   * The panel caches a response for five minutes, and an installer URL that changes with
   * every release means a cached copy can only ever be the build it was named after — never
   * last week's installer handed out under this week's version number.
   */
  href: string
}

export async function getLoader(): Promise<Loader> {
  const [body, probe] = await Promise.all([
    // The update feed answers with a nested object — the same one the desktop app adopts.
    read<{ update?: { version?: unknown; tag?: unknown } | null }>('/api/loader/update', {}),
    /*
     * No retry, and a shorter leash than the catalogue.
     *
     * This one is a verification, not the page's content: if it is slow the page should
     * still render on time, without a size, rather than stall on a sleeping API twice.
     */
    once<InstallerProbe>('/api/loader/installer?probe=1', {}, 12_000)
  ])

  const update = body.update ?? null
  const probed = typeof probe.version === 'string' && probe.version ? probe.version : null
  const version =
    probed ?? (update && typeof update.version === 'string' && update.version ? update.version : null)

  const bytes = typeof probe.bytes === 'number' && probe.bytes > 0 ? probe.bytes : null

  return {
    version,
    bytes,
    name:
      typeof probe.name === 'string' && probe.name
        ? probe.name
        : version
          ? `INDRA-LOADER-Setup-${version}.exe`
          : null,
    verified: probe.reachable === true && bytes !== null,
    href: version ? `${INSTALLER_URL}?v=${encodeURIComponent(version)}` : INSTALLER_URL
  }
}

export function size(bytes: number | null): string {
  if (!bytes) return ''
  const mb = bytes / 1048576
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}
