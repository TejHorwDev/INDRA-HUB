import { compareVersions } from './version'
import { readConfig, writeConfig } from './db'

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

/**
 * What the last lookup did, step by step.
 *
 * Three sources, any of which can fail for a different reason, and the failure that
 * matters is always the one nobody can see. `?debug=1` on the endpoint prints this.
 */
let notes: string[] = []
export function lookupNotes(): string[] {
  return [...notes]
}
const note = (line: string): void => {
  notes.push(line)
  if (notes.length > 12) notes.shift()
}
let cache: { at: number; value: LatestRelease | null } | null = null

async function json<T>(url: string, timeoutMs = 8_000): Promise<T> {
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

/**
 * The newest tag, read from the release feed instead of the API.
 *
 * `api.github.com` is rate limited by address, and a datacentre address is shared
 * with strangers. When it answers 403 the panel was reduced to whatever it happened
 * to remember — which is fine for a day and wrong for a release.
 *
 * `releases.atom` is the same information GitHub has published as a feed since
 * forever: no authentication, no per-address budget, and one entry per release with
 * its tag in the link. It is the difference between a feature that needs an operator
 * and one that maintains itself.
 */
async function newestFromFeed(): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(`https://github.com/${REPO}/releases.atom`, {
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
      headers: { accept: 'application/atom+xml', 'user-agent': 'indra-loader-api' }
    })
    if (!response.ok) throw new Error(`GitHub answered HTTP ${response.status}`)

    const xml = await response.text()
    let best: string | null = null
    let bestVersion: string | null = null

    for (const match of xml.matchAll(/releases\/tag\/([^"']+)/g)) {
      const tag = decodeURIComponent(match[1])
      const version = versionFromTag(tag)
      if (!version) continue
      if (!bestVersion || compareVersions(version, bestVersion) > 0) {
        best = tag
        bestVersion = version
      }
    }

    return best
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The newest loader tag, read from the releases page's own search.
 *
 * Two things are rate limited or useless here: `api.github.com` by address, and the
 * Atom feed by only ever listing the ten most recent releases — of which the hub's
 * had filled every slot, so the loader's own tags were not in the feed at all.
 *
 * The releases page, filtered by the word in every loader release title, lists
 * loader releases and nothing else, needs no authentication, and has no per-address
 * budget. It is a page written for a browser, so this parses tags and nothing else —
 * and every candidate is still checked against the release's own manifest before it
 * is offered to anybody.
 */
async function newestFromSearch(): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(`https://github.com/${REPO}/releases?q=INDRA+LOADER&expanded=true`, {
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
      headers: { accept: 'text/html', 'user-agent': 'indra-loader-api' }
    })
    if (!response.ok) throw new Error(`GitHub answered HTTP ${response.status}`)

    const html = await response.text()
    let best: string | null = null
    let bestVersion: string | null = null

    for (const match of html.matchAll(/releases\/tag\/(loader-v[0-9][0-9.]*)/g)) {
      const tag = match[1]
      const version = versionFromTag(tag)
      if (!version) continue
      if (!bestVersion || compareVersions(version, bestVersion) > 0) {
        best = tag
        bestVersion = version
      }
    }

    return best
  } finally {
    clearTimeout(timer)
  }
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

async function remember(release: LatestRelease): Promise<void> {
  try {
    const config = await readConfig()
    const next = JSON.stringify(release)
    if (config[REMEMBERED_KEY] === next) return
    await writeConfig({ [REMEMBERED_KEY]: next })
  } catch {
    /* remembering is a convenience, never a requirement */
  }
}

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

/**
 * How long a request may wait for GitHub before it is answered from memory.
 *
 * The app asks this endpoint at launch, in front of the window, with a card showing
 * "Checking for updates". A cold Render instance plus a rate-limited API plus a page
 * fetch is longer than anybody should be made to watch a spinner, and longer than the
 * app's own patience. So the slow path is a background job: the caller is answered in
 * a couple of seconds from the last good answer, and the fresh one is waiting for the
 * next call.
 */
const WAIT_BUDGET_MS = 2_500

/** One lookup at a time, however many callers ask. */
let inFlight: Promise<LatestRelease | null> | null = null

function lookup(): Promise<LatestRelease | null> {
  if (inFlight) return inFlight

  inFlight = runLookup().finally(() => {
    inFlight = null
  })
  return inFlight
}

/** What the newest published loader is. `null` when nothing has been published. */
export async function latestLoaderRelease(): Promise<LatestRelease | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value

  const rememberedNow = await remembered()
  if (rememberedNow) {
    const fresh = lookup().catch(() => null)
    const raced = await Promise.race([
      fresh,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_BUDGET_MS))
    ])
    /* The lookup may still be running; it updates the cache and the stored release. */
    return raced ?? rememberedNow
  }

  return lookup()
}

async function runLookup(): Promise<LatestRelease | null> {
  try {
    let tag: string | null = null
    let publishedAt = ''

    notes = []
    const release = await newest().catch((error: unknown) => {
      note(`api: ${error instanceof Error ? error.message : String(error)}`)
      return null
    })
    if (release) {
      tag = release.tag_name as string
      publishedAt = release.published_at ?? ''
      note(`api: ${tag}`)
    }

    /*
     * The API did not answer — the feed still can. Two independent ways of asking the
     * same question, and only the manifest itself is a hard requirement.
     */
    if (!tag) {
      tag = await newestFromFeed().catch((error: unknown) => {
        note(`feed: ${error instanceof Error ? error.message : String(error)}`)
        return null
      })
      if (tag) note(`feed: ${tag}`)
    }

    if (!tag) {
      tag = await newestFromSearch().catch((error: unknown) => {
        note(`page: ${error instanceof Error ? error.message : String(error)}`)
        return null
      })
      if (tag) note(`page: ${tag}`)
    }

    /*
     * Nothing answered. The remembered release is the last honest thing we know, and
     * it is better than telling an app that has an update waiting that it is current.
     */
    if (!tag) {
      const fallback = await remembered()
      if (fallback) {
        note(`remembered: ${fallback.tag}`)
        return fallback
      }
      note('nothing answered')
      cache = { at: Date.now(), value: null }
      return null
    }

    const version = versionFromTag(tag) as string
    const manifest = await manifestOf(tag, version).catch((error: unknown) => {
      note(`manifest: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    })

    const value: LatestRelease = { version, tag, publishedAt, manifest }
    cache = { at: Date.now(), value }

    /*
     * Remember what was just learned.
     *
     * The memory is only useful if it is current, and it can only be current if
     * something writes to it. Doing that here means every successful lookup — by any
     * of the three sources — refreshes the answer the next outage will fall back on.
     */
    void remember(value)

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
