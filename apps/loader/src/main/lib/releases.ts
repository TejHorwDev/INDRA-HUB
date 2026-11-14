import { compareVersions } from './version'

/*
 * Finding *this* app's newest release.
 *
 * INDRA HUB and INDRA LOADER are published from one repository, so the familiar
 * `releases/latest` is the wrong question: it answers with whichever app
 * released most recently. A loader asking it would eventually download the hub's
 * payload and boot it, which is the single most expensive mistake this updater
 * could make.
 *
 * So the loader asks for the release *list* and filters by tag prefix. The
 * selection below is pure and exported, because `sim:update` proves it against a
 * fixture where a hub release is newer than the loader's — the exact situation
 * that a `releases/latest` implementation gets wrong.
 */

export interface ReleaseAsset {
  name?: string
  browser_download_url?: string
}

export interface Release {
  tag_name?: string
  draft?: boolean
  prerelease?: boolean
  published_at?: string
  assets?: ReleaseAsset[]
}

export interface SelectedRelease {
  tag: string
  version: string
  publishedAt: string
}

/** `loader-v1.4.2` → `1.4.2`, and anything else → null. */
export function versionFromTag(tag: string, prefix: string): string | null {
  if (!tag.startsWith(prefix)) return null
  const version = tag.slice(prefix.length).replace(/^v/i, '')
  return /^\d+(\.\d+){0,3}([-+][0-9A-Za-z.-]+)?$/.test(version) ? version : null
}

/**
 * The newest non-draft release carrying this app's prefix.
 *
 * Ordering is by version number, not by `published_at`: re-publishing an old
 * release must never make the app offer a downgrade, and a clock skew on a
 * runner must never make it skip one. `published_at` is only used to break ties
 * between two releases of the same version.
 */
export function selectRelease(releases: Release[], prefix: string): SelectedRelease | null {
  let best: SelectedRelease | null = null

  for (const release of releases) {
    if (!release || release.draft) continue
    const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
    const version = versionFromTag(tag, prefix)
    if (!version) continue

    const publishedAt = typeof release.published_at === 'string' ? release.published_at : ''
    const candidate: SelectedRelease = { tag, version, publishedAt }

    if (!best) {
      best = candidate
      continue
    }

    const order = compareVersions(candidate.version, best.version)
    if (order > 0 || (order === 0 && candidate.publishedAt > best.publishedAt)) {
      best = candidate
    }
  }

  return best
}

/** Where this release's manifest lives. Constructed from the tag, never guessed. */
export function manifestUrl(repo: string, tag: string): string {
  return `https://github.com/${repo}/releases/download/${tag}/payload.json`
}

/** The list endpoint, newest releases first. 20 is far more than two trains need. */
export function releaseListUrl(repo: string): string {
  return `https://api.github.com/repos/${repo}/releases?per_page=20`
}
