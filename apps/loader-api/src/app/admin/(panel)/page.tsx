import Link from 'next/link'
import { databaseReady } from '@/lib/env'
import { listApps, readConfig } from '@/lib/db'
import { latestLoaderRelease } from '@/lib/github'
import Stat from '@/components/Stat'

export const dynamic = 'force-dynamic'

/*
 * The control room.
 *
 * It used to be four cards, a moving tape of repeated facts, a "jump to" card that linked
 * to the four links already in the header, a "shortcuts" card listing three endpoints
 * nobody types, and a table of the catalogue that repeated the next page. Every one of
 * those was true, and none of them was worth the space it took.
 *
 * What is left is what gets looked at:
 *
 *   1. Three numbers and a weight, at the size numbers deserve.
 *   2. What the app is being told, in one list of six lines.
 *   3. The catalogue, one row each, big enough to read across the room.
 *
 * Everything here is read from the tables the loader reads. Nothing is cached and nothing
 * is estimated — a dashboard that can be stale is a dashboard that lies during exactly
 * the incident it exists for.
 */

function size(bytes: number): string {
  if (!bytes) return '—'
  const mb = bytes / 1048576
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}

export default async function OverviewPage(): Promise<React.JSX.Element> {
  if (!databaseReady()) {
    return (
      <div className="page">
        <h1>Overview</h1>
        <p className="lede">
          Set <span className="mono">SUPABASE_URL</span> and{' '}
          <span className="mono">SUPABASE_SERVICE_ROLE_KEY</span> on this deployment.
        </p>
      </div>
    )
  }

  /*
   * The update feed, read the same way the app reads it.
   *
   * If this row says a version, the app can see it too — the panel and the updater go
   * through one function on purpose, so this is a real answer rather than a hopeful one.
   */
  const feed = await latestLoaderRelease()
    .then((release) => (release ? { version: release.version, tag: release.tag } : null))
    .catch(() => ({ version: 'unreachable', tag: '' }))

  let apps: Awaited<ReturnType<typeof listApps>> = []
  let config: Record<string, string> = {}
  let failure: string | null = null

  try {
    ;[apps, config] = await Promise.all([listApps(), readConfig()])
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Could not read the database.'
  }

  const active = apps.filter((app) => app.status === 'active').length
  const gated = apps.filter((app) => app.keyauth_app_id).length
  const bytes = apps.reduce((total, app) => total + (app.exe_bytes ?? 0), 0)
  const video = config['video'] ?? ''
  const website = config['website'] ?? ''
  const maintenance = config['maintenance'] === '1' || config['maintenance'] === 'true'
  const notice = config['notice'] ?? ''
  const filmBlur = Number(config['film_blur'] ?? 0) || 0
  const filmDim = Number(config['film_dim'] ?? 0) || 0

  const feedVersion = feed && 'version' in feed && feed.version !== 'unreachable' ? feed.version : null
  const state = failure ? 'Unreachable' : maintenance ? 'Closed' : 'Live'

  return (
    <div className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">
            <span className="dot" data-tone={failure || maintenance ? 'warn' : undefined} />
            {state}
          </p>
          <h1>Overview</h1>
          <p className="lede">
            {failure
              ? 'The database did not answer.'
              : `Everything the loader is serving, and everything it is being told, on one page.`}
          </p>
        </div>

        <dl className="hero-facts">
          <div>
            <dt>Build</dt>
            <dd>{feedVersion ?? '—'}</dd>
          </div>
          <div>
            <dt>Products</dt>
            <dd>{apps.length}</dd>
          </div>
          <div>
            <dt>Weight</dt>
            <dd>{size(bytes)}</dd>
          </div>
        </dl>
      </section>

      {failure ? <p className="notice error">{failure}</p> : null}

      {maintenance ? (
        <p className="notice error">
          Maintenance is on: the app shows a closed sign to everyone.{' '}
          <Link href="/admin/settings">Turn it off</Link>.
        </p>
      ) : null}

      <div className="stats">
        <Stat value={apps.length} label="Products" index={0} />
        <Stat value={active} label="Active" index={1} />
        <Stat value={apps.length - active} label="Locked" index={2} />
        <Stat value={size(bytes)} label="Installers" index={3} />
      </div>

      <section className="split">
        <h2 className="split-label">What the app is told</h2>
        <div className="split-body">
          <dl className="kv">
            <dt>Film</dt>
            <dd>
              {video ? (
                <>
                  <span className="mono">{video.split('/').pop()}</span>
                  {filmBlur || filmDim ? (
                    <span className="hint">
                      {filmBlur}px blur · {filmDim}% dark
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="quiet">none — the wash is showing</span>
              )}
            </dd>

            <dt>Website</dt>
            <dd>{website ? <span className="mono">{website}</span> : <span className="quiet">hidden</span>}</dd>

            <dt>Announcement</dt>
            <dd>{notice ? <span>{notice}</span> : <span className="quiet">none</span>}</dd>

            <dt>Access</dt>
            <dd>
              <span className="mono">
                {gated} of {apps.length} gated
              </span>
              <span className="hint">by INDRA Auth, when the app opens</span>
            </dd>

            <dt>Update feed</dt>
            <dd>
              {feedVersion ? (
                <span className="mono">{feedVersion}</span>
              ) : (
                <span className="quiet">{feed === null ? 'no release published' : 'GitHub unreachable'}</span>
              )}
            </dd>
          </dl>
          <Link href="/admin/settings" className="block-action">
            Change these
          </Link>
        </div>
      </section>

      <section className="split">
        <h2 className="split-label">
          Catalogue <span className="count">{String(apps.length).padStart(2, '0')}</span>
        </h2>
        <div className="split-body">
          {apps.length === 0 ? (
            <p className="quiet">
              Nothing published yet. <Link href="/admin/apps">Add the first product.</Link>
            </p>
          ) : (
            <div className="rows">
              {apps.map((app) => (
                <Link key={app.id} href="/admin/apps" className="row-link">
                  <span className="row-name">{app.name}</span>
                  <span className="row-meta mono">v{app.version}</span>
                  <span className="row-meta mono">{size(app.exe_bytes ?? 0)}</span>
                  <span className={`pill ${app.status === 'active' ? 'ok' : 'off'}`}>{app.status}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
