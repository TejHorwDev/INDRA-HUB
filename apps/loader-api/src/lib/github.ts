import { compareVersions } from './version'
import { readConfig } from './db'

/*
 * The other half of the updater: what GitHub says the newest loader release is.
 *
 * The desktop app can ask GitHub itself, and does — but only as a fallback. GitHub
 * serves release assets from `release-assets.githubusercontent.com`, a host that is
 * routinely filtered by ISPs, corporate firewalls and antivirus web shields. When it
 * is blocked, an app that talks to GitHub directly cannot update at all, and the
 * person holding it has no way to tell a blocked download from a broken app.
 *
 * So the panel asks instead. This service runs in a datacentre, reaches GitHub
 * reliably, and hands the app three small things: a version, a hash, and a URL on
 * *this* domain that streams the payload. If the panel is reachable — and the app
 * already depends on it for the catalogue — the update works.
 */

const REPO = 'TejHorwDev/INDRA-HUB'
/** Both applications publish to one repository; this prefix is the loader's. */
const PREFIX = 'loader-v'

interface ReleaseAsset {
  name?: string
  browser_download_url?: string
}

interface Release {
  tag_name?: string
  draft?: boolean
  prerelease?: boolean
  published_at?: string
  assets?: ReleaseAsset[]
}

export interface LoaderManifest {
  version: string
  file: string
  sha256: string
  size: number
}

export interface LatestRelease {
  version: string
  tag: string
  publishedAt: string
  manifest: LoaderManifest
}

/** `loader-v1.4.2` → `1.4.2`; anything else → null. */
function versionFromTag(tag: string): string | null {
  if (!tag.startsWith(PREFIX)) return null
  const version = tag.slice(PREFIX.length).replace(/^v/i, '')
  return /^\d+(\.\d+){0,3}([-+][0-9A-Za-z.-]+)?$/.test(version) ? version : null
}

/**
 * A minute of memory.
 *
 * The app checks at launch and again on focus, and a refresh loop in a browser tab
 * should not turn into a GitHub rate limit for everybody. One minute is short enough
 * that publishing a release and pressing check twice still sees it.
 */
const TTL_MS = 60_000
let cache: { at: number; value: LatestRelease | null } | null = null

async function json<T>(url: string, timeoutMs = 12_000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'indra-loader-api' }
    })
    if (!response.ok) throw new Error(`GitHub answered HTTP ${response.status}`)
    return (await response.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/** The newest non-draft loader release, by version rather than by date. */
async function newest(): Promise<Release | null> {
  const list = await json<Release[]>(`https://api.github.com/repos/${REPO}/releases?per_page=100`)

  let best: { release: Release; version: string } | null = null
  for (const release of Array.isArray(list) ? list : []) {
    if (!release || release.draft) continue
    const version = versionFromTag(release.tag_name ?? '')
    if (!version) continue
    if (!best || compareVersions(version, best.version) > 0) best = { release, version }
  }

  return best?.release ?? null
}

/** The release's own manifest, which is the authority on file, hash and size. */
async function manifestOf(tag: string, version: string): Promise<LoaderManifest> {
  const body = await json<Partial<LoaderManifest>>(
    `https://github.com/${REPO}/releases/download/${tag}/payload.json`
  )

  const file = typeof body.file === 'string' ? body.file : ''
  const sha256 = typeof body.sha256 === 'string' ? body.sha256.toLowerCase() : ''

  if (!/^[a-f0-9]{64}$/.test(sha256) || !/\.asar$/i.test(file) || !file.includes(version)) {
    throw new Error('The release manifest is not usable.')
  }

  return { version, file, sha256, size: Number(body.size) || 0 }
}

/**
 * The release, remembered in the database.
 *
 * GitHub's API is rate limited by address, and a shared datacentre address can be
 * spent by strangers. It can also simply be down. Either way the app must still be
 * offerable an update, so the last release that was ever read successfully is kept
 * in `loader_config` and used when GitHub cannot be asked.
 *
 * Writing it is not the panel's job: a release is published by CI, so a value here
 * can only ever be one that a real release produced.
 */
const REMEMBERED_KEY = 'latest_release'

async function remembered(): Promise<LatestRelease | null> {
  try {
    const config = await readConfig()
    const raw = config[REMEMBERED_KEY]
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<LatestRelease> & { manifest?: Partial<LoaderManifest> }
    const manifest = parsed.manifest
    if (!manifest) return null

    const version = typeof manifest.version === 'string' ? manifest.version : ''
    const file = typeof manifest.file === 'string' ? manifest.file : ''
    const sha256 = typeof manifest.sha256 === 'string' ? manifest.sha256.toLowerCase() : ''

    if (!version || !/^[a-f0-9]{64}$/.test(sha256) || !/\.asar$/i.test(file)) return null

    return {
      version,
      tag: typeof parsed.tag === 'string' ? parsed.tag : `loader-v${version}`,
      publishedAt: typeof parsed.publishedAt === 'string' ? parsed.publishedAt : '',
      manifest: { version, file, sha256, size: Number(manifest.size) || 0 }
    }
  } catch {
    return null
  }
}

/** What the newest published loader is. `null` when nothing has been published. */
export async function latestLoaderRelease(): Promise<LatestRelease | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value

  try {
    const release = await newest()
    if (!release) {
      cache = { at: Date.now(), value: null }
      return null
    }

    const tag = release.tag_name as string
    const version = versionFromTag(tag) as string
    const manifest = await manifestOf(tag, version)

    const value: LatestRelease = {
      version,
      tag,
      publishedAt: release.published_at ?? '',
      manifest
    }
    cache = { at: Date.now(), value }
    return value
  } catch (error) {
    console.warn('[github] release lookup failed', error instanceof Error ? error.message : error)

    /*
     * GitHub could not be asked. If a release was ever recorded, that answer is
     * better than no answer — the app gets an update it can install rather than a
     * sentence about the weather in GitHub's datacentre.
     */
    const fallback = await remembered()
    if (fallback) {
      console.warn('[github] using the remembered release', fallback.tag)
      return fallback
    }

    /* A failed lookup is not a cached answer — the next request tries again. */
    throw error
  }
}

/** The tag and file, accepted only in the shapes a release can produce. */
export function isReleaseFile(tag: string, file: string): boolean {
  return /^loader-v\d+(\.\d+){0,3}$/.test(tag) && /^[A-Za-z0-9._-]+\.asar$/.test(file)
}

/** GitHub's address for an asset. Only ever called with the two parts checked above. */
export function assetUrl(tag: string, file: string): string {
  return `https://github.com/${REPO}/releases/download/${tag}/${file}`
}
