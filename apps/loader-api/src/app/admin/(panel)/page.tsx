import Link from 'next/link'
import { databaseReady } from '@/lib/env'
import { listApps, readConfig } from '@/lib/db'

export const dynamic = 'force-dynamic'

/*
 * The control room.
 *
 * Until now the panel opened on the product list, which answered "what is in the
 * catalogue" and nothing else. The questions an operator actually asks first are
 * different: is the app publishing anything, is the film set, is the door shut, is
 * the database the one I think it is. Those are all answerable on one screen from
 * data that is already loaded, so they are on one screen.
 *
 * Every number here is read from the same tables the loader reads. Nothing is
 * cached and nothing is estimated — a dashboard that can be stale is a dashboard
 * that lies during exactly the incident it exists for.
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

  return (
    <>
      <h1>Overview</h1>
      <p className="lede">What the loader is publishing right now, and what it is reading it from.</p>

      {failure ? (
        <div className="notice error" style={{ marginBottom: 18 }}>
          {failure}
        </div>
      ) : null}

      {maintenance ? (
        <div className="notice error" style={{ marginBottom: 18 }}>
          Maintenance mode is on — the app is showing a closed sign to everyone. The catalogue is
          still published; it is simply not shown. <Link href="/admin/settings">Turn it off</Link>.
        </div>
      ) : null}

      <div className="stats">
        <div className="stat">
          <span className="stat-value">{apps.length}</span>
          <span className="stat-label">Products</span>
        </div>
        <div className="stat">
          <span className="stat-value">{active}</span>
          <span className="stat-label">Active</span>
        </div>
        <div className="stat">
          <span className="stat-value">{apps.length - active}</span>
          <span className="stat-label">Locked</span>
        </div>
        <div className="stat">
          <span className="stat-value">{count(bytes)}</span>
          <span className="stat-label">Installers</span>
        </div>
      </div>

      <div className="card">
        <h2>What the app is being told</h2>
        <table>
          <tbody>
            <tr>
              <td>Sign-in film</td>
              <td>
                {video ? (
                  <>
                    <span className="pill ok">set</span>{' '}
                    <span className="mono">{video.split('/').pop()}</span>
                  </>
                ) : (
                  <span className="pill off">not set — animated wash</span>
                )}
              </td>
            </tr>
            <tr>
              <td>Website link</td>
              <td>
                {website ? (
                  <span className="mono">{website}</span>
                ) : (
                  <span className="pill off">hidden</span>
                )}
              </td>
            </tr>
            <tr>
              <td>Announcement</td>
              <td>
                {notice ? (
                  <span>{notice}</span>
                ) : (
                  <span className="pill off">none</span>
                )}
              </td>
            </tr>
            <tr>
              <td>Gated products</td>
              <td>
                <span className="mono">
                  {gated} of {apps.length}
                </span>{' '}
                <span className="hint">— checked against INDRA Auth when the app opens</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Published catalogue</h2>
        {apps.length === 0 ? (
          <div className="empty">
            Nothing published yet. <Link href="/admin/apps">Add the first product</Link>.
          </div>
        ) : (
          <table>
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
                  <td className="mono">{count(app.exe_bytes ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Shortcuts</h2>
        <p className="hint" style={{ marginBottom: 12 }}>
          The public endpoints, for checking what a client actually receives.
        </p>
        <p className="mono" style={{ lineHeight: 2, fontSize: 12 }}>
          <a href="/api/loader/config" target="_blank" rel="noreferrer">
            /api/loader/config
          </a>
          <br />
          <a href="/api/loader/apps" target="_blank" rel="noreferrer">
            /api/loader/apps
          </a>
          <br />
          <a href="/api/health" target="_blank" rel="noreferrer">
            /api/health
          </a>
        </p>
      </div>
    </>
  )
}
