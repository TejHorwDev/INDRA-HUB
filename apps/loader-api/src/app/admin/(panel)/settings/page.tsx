import LinkConfig from '@/components/LinkConfig'
import { adminReady, databaseReady } from '@/lib/env'
import { driver } from '@/lib/storage'

export const dynamic = 'force-dynamic'

/*
 * Settings.
 *
 * Two things live here: the one link the app publishes, and an honest statement of
 * what the deployment is actually connected to. The second is not decoration — when
 * something does not work, the first question is always which half of the machine
 * is missing.
 */
export default function SettingsPage(): React.JSX.Element {
  const storage = driver()

  return (
    <>
      <h1>Settings</h1>
      <p className="lede">What the loader reads, and what this deployment is connected to.</p>

      <div className="card">
        <h2>Links</h2>
        <LinkConfig />
      </div>

      <div className="card">
        <h2>This deployment</h2>
        <table>
          <tbody>
            <tr>
              <td>Database</td>
              <td>
                <span className={`pill ${databaseReady() ? 'ok' : 'off'}`}>
                  {databaseReady() ? 'Supabase connected' : 'not configured'}
                </span>
              </td>
            </tr>
            <tr>
              <td>Storage</td>
              <td>
                <span className="pill ok">{storage}</span>{' '}
                <span className="mono">
                  {storage === 'local'
                    ? '.data/uploads — development only'
                    : `${storage === 'r2' ? 'Cloudflare R2' : storage === 'b2' ? 'Backblaze B2' : 'Supabase Storage'}`}
                </span>
              </td>
            </tr>
            <tr>
              <td>Admin</td>
              <td>
                <span className={`pill ${adminReady() ? 'ok' : 'off'}`}>
                  {adminReady() ? 'configured' : 'missing credentials'}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Buckets</h2>
        <p className="hint" style={{ lineHeight: 1.8 }}>
          Uploads are presigned: the browser writes straight to the bucket, so the bucket needs a CORS
          rule allowing <code>PUT</code> and <code>POST</code> from this origin, and <code>GET</code> if
          you set <code>PUBLIC_BASE_URL</code>. Without a public base the API serves the files itself,
          which works with a private bucket and needs no CORS at all.
        </p>
      </div>
    </>
  )
}
