import { currentSession } from '@/lib/auth'
import { env, storageDriverConfigured } from '@/lib/env'
import {
  capFor,
  driver,
  formatBytes,
  usageByKind,
  type Kind
} from '@/lib/storage'

export const dynamic = 'force-dynamic'

/*
 * Storage.
 *
 * The question this page exists to answer, in the words it was asked: "my exes are
 * huge — if I upload from the panel, where does it go?" The answer is a driver, a
 * bucket, a real number of bytes, and the ceiling that applies to each kind of file.
 *
 * It is not decoration. The picker used to accept any file, spend ten minutes
 * uploading it, and then fail at the bucket's edge with a sentence about a payload
 * being too large. Whatever the ceiling is, it belongs on screen before the upload
 * starts — and so does the alternative when the file does not fit.
 */

const KIND_LABEL: Record<Kind, string> = {
  exe: 'Installers (.exe)',
  image: 'Card images',
  video: 'Background film'
}

const DRIVER_NOTE: Record<string, string> = {
  supabase:
    'Supabase Storage. 50 MB per file by default, 1 GB of storage and 5 GB of egress a month on the free plan. Fine for images and the film; not a home for a 120 MB installer.',
  r2:
    'Cloudflare R2. No per-file ceiling worth naming, and egress is free — the right home for installers.',
  b2:
    'Backblaze B2. No per-file ceiling worth naming, and cheap egress — also right for installers.',
  local: 'Local disk. Development only: nothing here survives the container.'
}

export default async function StoragePage(): Promise<React.JSX.Element> {
  if (!(await currentSession())) return <p className="hint">Not signed in.</p>

  const active = driver()
  const usage = await usageByKind()
  const kinds: Kind[] = ['exe', 'image', 'video']
  const total = 'error' in usage
    ? null
    : kinds.reduce((sum, kind) => sum + usage[kind].bytes, 0)
  const files = 'error' in usage
    ? null
    : kinds.reduce((sum, kind) => sum + usage[kind].count, 0)

  return (
    <>
      <h1>Storage</h1>

      <div className="card">
        <h2>{active === 'supabase' ? 'Supabase Storage' : active.toUpperCase()}</h2>
        <p className="hint">{DRIVER_NOTE[active] ?? 'Unknown driver.'}</p>
        <table>
          <tbody>
            <tr>
              <th>Driver</th>
              <td className="mono">{active}</td>
            </tr>
            <tr>
              <th>Bucket</th>
              <td className="mono">
                {active === 'r2' ? env.r2.bucket : active === 'b2' ? env.b2.bucket : active === 'supabase' ? env.supabaseBucket : '.data/uploads'}
              </td>
            </tr>
            <tr>
              <th>Stored</th>
              <td className="mono">
                {total === null ? 'could not be listed' : `${formatBytes(total)} in ${files} file${files === 1 ? '' : 's'}`}
              </td>
            </tr>
            <tr>
              <th>URLs</th>
              <td className="mono">
                {env.publicBaseUrl ? `${env.publicBaseUrl}/<key>` : '/api/files/<key> (served by this service)'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Ceiling per file</h2>
        <p className="hint">
          Enforced before the upload starts, so a file that cannot fit fails in the first
          second instead of the tenth minute.
        </p>
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Largest accepted</th>
              <th>Stored</th>
            </tr>
          </thead>
          <tbody>
            {kinds.map((kind) => (
              <tr key={kind}>
                <td>{KIND_LABEL[kind]}</td>
                <td className="mono">{formatBytes(capFor(kind))}</td>
                <td className="mono">
                  {'error' in usage
                    ? '—'
                    : `${usage[kind].count} · ${formatBytes(usage[kind].bytes)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Installers bigger than the ceiling</h2>
        <p className="hint">
          They do not need to go through the panel at all. Every release already
          publishes <span className="mono">INDRA-LOADER-Setup-&lt;version&gt;.exe</span>{' '}
          on GitHub, and the loader updates itself from the small payload beside it —
          nobody installs the setup twice. The panel&apos;s Installer field is for builds
          that fit the bucket.
        </p>
        <p className="hint">
          To host large files here instead, add{' '}
          <span className="mono">R2_ACCOUNT_ID</span>,{' '}
          <span className="mono">R2_ACCESS_KEY_ID</span>,{' '}
          <span className="mono">R2_SECRET_ACCESS_KEY</span> and{' '}
          <span className="mono">R2_BUCKET</span> to this deployment. The driver order is
          R2, then B2, then Supabase, then local disk — the first one with credentials
          wins, and the ceiling follows it automatically.
        </p>
        {storageDriverConfigured() ? null : (
          <p className="hint">
            No storage credentials are set on this deployment, so uploads would land on
            local disk. Set <span className="mono">SUPABASE_URL</span> and{' '}
            <span className="mono">SUPABASE_SERVICE_ROLE_KEY</span>, or the R2 pair above.
          </p>
        )}
      </div>
    </>
  )
}
