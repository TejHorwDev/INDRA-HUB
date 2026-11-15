import Link from 'next/link'
import { databaseReady } from '@/lib/env'
import { listApps, readConfig } from '@/lib/db'
import { latestLoaderRelease } from '@/lib/github'
import Stat from '@/components/Stat'

export const dynamic = 'force-dynamic'

/*
 * The control room.
 *
 * Three questions, in the order they are asked when something feels wrong:
 *
 *   1. How much of this is actually live — four numbers, counted up, top of the page.
 *   2. What is the app being told right now — film, links, announcement, feed, gates.
 *   3. What is in the catalogue — one row per product, nothing hidden behind a click.
 *
 * Every number here is read from the same tables the loader reads. Nothing is cached
 * and nothing is estimated — a dashboard that can be stale is a dashboard that lies
 * during exactly the incident it exists for.
 */

function count(bytes: number): string {
  if (!bytes) return '—'
  const mb = bytes / 1048576
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}

export default async function OverviewPage(): Promise<React.JSX.Element> {
  if (!databaseReady()) {
    return (
      <>
        <p className="eyebrow">
          <span className="dot" data-tone="off" />
          not configured
        </p>
        <h1>Overview</h1>
        <div className="card">
          <h2>Database not configured</h2>
          <p className="hint">
            Set <span className="mono">SUPABASE_URL</span> and{' '}
            <span className="mono">SUPABASE_SERVICE_ROLE_KEY</span> on this deployment.
          </p>
        </div>
      </>
    )
  }

  /*
   * The update feed, read the same way the app reads it.
   *
   * If this row says a version, the app can see it too — the panel and the updater
   * go through one function on purpose, so this is a real answer rather than a
   * hopeful one.
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

  const tone = failure ? 'warn' : maintenance ? 'warn' : 'live'
  const state = failure
    ? 'Database unreachable'
    : maintenance
      ? 'Maintenance on'
      : feed && 'version' in feed && feed.version !== 'unreachable'
        ? `Publishing ${feed.version}`
        : 'Publishing'

  /*
   * The tape. One line of facts that moves, built from the same rows as the cards below
   * it — so if the panel says 1.0.36 in the tape it says 1.0.36 in the table. Doubled,
   * because the loop is a single translation of minus half the track.
   */
  const facts = [
    `${apps.length} product${apps.length === 1 ? '' : 's'}`,
    `${active} active`,
    gated ? `${gated} gated by INDRA Auth` : 'no gates',
    feed && 'version' in feed && feed.version !== 'unreachable' ? `feed ${feed.version}` : 'no feed',
    video ? 'sign-in film set' : 'no film — wash',
    website ? 'website linked' : 'website hidden',
    notice ? 'announcement live' : 'no announcement',
    maintenance ? 'maintenance on' : 'catalogue public',
    count(bytes) === '—' ? 'no installers' : `${count(bytes)} of installers`
  ]

  return (
    <div className="page">
      <div className="page-head">
        <p className="eyebrow">
          <span className="dot" data-tone={tone === 'live' ? undefined : 'warn'} />
          {state}
          <span style={{ color: 'var(--ink-4)' }}>/ {apps.length} products</span>
        </p>

        <h1>Overview</h1>
        <p className="lede">What the loader is publishing right now, and what it is reading it from.</p>
      </div>

      {failure ? <div className="notice error">{failure}</div> : null}

      {maintenance ? (
        <div className="notice error">
          Maintenance mode is on — the app is showing a closed sign to everyone. The catalogue is
          still published; it is simply not shown. <Link href="/admin/settings">Turn it off</Link>.
        </div>
      ) : null}

      <div className="stats">
        <Stat value={apps.length} label="Products" index={0} share={1} />
        <Stat value={active} label="Active" index={1} share={apps.length ? active / apps.length : 0} />
        <Stat
          value={apps.length - active}
          label="Locked"
          index={2}
          share={apps.length ? (apps.length - active) / apps.length : 0}
        />
        <Stat value={count(bytes)} label="Installers" index={3} share={0.55} />
      </div>

      <div className="tape" aria-hidden="true">
        <div className="tape-track">
          {[...facts, ...facts].map((fact, index) => (
            <span className="tape-item" key={`${fact}-${index}`}>
              <b>{fact}</b>
            </span>
          ))}
        </div>
      </div>

      <div className="grid cols">
        <div className="col">
          <div className="card" style={{ '--i': 4 } as React.CSSProperties}>
            <h2>What the app is being told</h2>
            <dl className="kv">
              <dt>Sign-in film</dt>
              <dd>
                {video ? (
                  <>
                    <span className="pill ok">set</span>
                    <span className="mono">{video.split('/').pop()}</span>
                  </>
                ) : (
                  <span className="pill off">not set — animated wash</span>
                )}
              </dd>

              <dt>Film frame</dt>
              <dd>
                {filmBlur || filmDim ? (
                  <span className="mono">
                    {filmBlur}px blur · {filmDim}% dark
                  </span>
                ) : (
                  <span className="mono">sharp and undimmed</span>
                )}
              </dd>

              <dt>Website link</dt>
              <dd>{website ? <span className="mono">{website}</span> : <span className="pill off">hidden</span>}</dd>

              <dt>Announcement</dt>
              <dd>{notice ? <span>{notice}</span> : <span className="pill off">none</span>}</dd>

              <dt>Update feed</dt>
              <dd>
                {feed === null ? (
                  <span className="pill off">no release published</span>
                ) : feed.version === 'unreachable' ? (
                  <span className="pill off">GitHub is not reachable from here right now</span>
                ) : (
                  <>
                    <span className="pill ok">{feed.version}</span>
                    <span className="mono">{feed.tag}</span>
                    <span className="hint">offered at launch</span>
                  </>
                )}
              </dd>

              <dt>Gated products</dt>
              <dd>
                <span className="mono">
                  {gated} of {apps.length}
                </span>
                <span className="hint">checked against INDRA Auth when the app opens</span>
              </dd>
            </dl>
          </div>

        </div>

        <div className="col">
          <div className="card" style={{ '--i': 6 } as React.CSSProperties}>
            <h2>Jump to</h2>
            <div className="grid" style={{ gap: 10 }}>
              <Link href="/admin/apps" className="tile">
                <p className="tile-title">Products</p>
                <p className="tile-note">Add an app, replace an installer, change card artwork.</p>
              </Link>
              <Link href="/admin/settings" className="tile">
                <p className="tile-title">Sign-in film</p>
                <p className="tile-note">{video ? 'Replace the film behind the door.' : 'No film set — the wash is showing.'}</p>
              </Link>
              <Link href="/admin/storage" className="tile">
                <p className="tile-title">Storage</p>
                <p className="tile-note">Where the files live, and what is using the space.</p>
              </Link>
            </div>
          </div>

          <div className="card" style={{ '--i': 7 } as React.CSSProperties}>
            <h2>Shortcuts</h2>
            <p className="hint" style={{ marginBottom: 12 }}>
              The public endpoints, for checking what a client actually receives.
            </p>
            <div className="endpoints">
              <a href="/api/loader/config" target="_blank" rel="noreferrer">
                /api/loader/config
              </a>
              <a href="/api/loader/apps" target="_blank" rel="noreferrer">
                /api/loader/apps
              </a>
              <a href="/api/health" target="_blank" rel="noreferrer">
                /api/health
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ '--i': 5 } as React.CSSProperties}>
        <h2>
          <span className="count">{String(apps.length).padStart(2, '0')}</span>
          Published catalogue
        </h2>
        {apps.length === 0 ? (
          <div className="empty">
            Nothing published yet. <Link href="/admin/apps">Add the first product</Link>.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Version</th>
                <th>Status</th>
                <th>Access</th>
                <th style={{ textAlign: 'right' }}>Installer</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => (
                <tr key={app.id}>
                  <td>
                    <strong>{app.name}</strong>
                  </td>
                  <td className="mono">{app.version}</td>
                  <td>
                    <span className={`pill ${app.status === 'active' ? 'ok' : 'off'}`}>{app.status}</span>
                  </td>
                  <td className="mono">{app.keyauth_app_id ? 'gated' : 'open'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {count(app.exe_bytes ?? 0)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link href="/admin/apps" className="row-action">
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
