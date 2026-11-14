'use client'

import { useCallback, useEffect, useState } from 'react'

/*
 * The bucket form.
 *
 * Three questions people actually have, in order: where do my files go, what are the
 * limits, and is the thing I just typed working. Each gets an answer on this card, and
 * the third one is a real write to the bucket rather than a validation message.
 *
 * Secrets are never printed back. Every field that holds one shows a masked value from
 * the server and is left empty otherwise — an empty box means "keep what is there", so
 * saving this form can never wipe a working key by accident.
 */

type DriverChoice = 'auto' | 'r2' | 'b2' | 'supabase' | 'local'

interface Saved {
  driver: DriverChoice
  updatedAt: string | null
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }
  b2: { keyId: string; applicationKey: string; bucket: string; region: string }
}

interface Status {
  driver: string
  reason: string
  ready: boolean
  configured: boolean
  bucket: string
  endpoint: string | null
  region: string | null
  capsLabel: { exe: string; image: string; video: string }
  saved: Saved
  usage: Record<string, { count: number; bytes: number }> | { error: string }
  origin: string
}

const DRIVERS: Array<{ id: DriverChoice; label: string; note: string }> = [
  {
    id: 'auto',
    label: 'Automatic',
    note: 'Uses whichever bucket has complete credentials — B2 and R2 can be filled in below without choosing them first.'
  },
  { id: 'b2', label: 'Backblaze B2', note: 'No per-file ceiling, 10 GB free, cheap egress. Best for installers.' },
  { id: 'r2', label: 'Cloudflare R2', note: 'No per-file ceiling, 10 GB free, free egress.' },
  { id: 'supabase', label: 'Supabase Storage', note: '50 MB per file on the free plan. Fine for images and the film.' },
  { id: 'local', label: 'Local disk', note: 'Development only: nothing here survives a deploy.' }
]

export default function StorageSettings(): React.JSX.Element {
  const [status, setStatus] = useState<Status | null>(null)
  const [driver, setDriver] = useState<DriverChoice>('auto')
  const [r2, setR2] = useState({ accountId: '', accessKeyId: '', secretAccessKey: '', bucket: '' })
  const [b2, setB2] = useState({ keyId: '', applicationKey: '', bucket: '', region: 'us-west-004' })
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const response = await fetch('/api/admin/storage')
    if (!response.ok) return
    const data = (await response.json()) as Status
    setStatus(data)
    setDriver(data.saved.driver)
    setR2((current) => ({ ...current, bucket: data.saved.r2.bucket }))
    setB2((current) => ({
      ...current,
      bucket: data.saved.b2.bucket,
      region: data.saved.b2.region || 'us-west-004'
    }))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save(): Promise<void> {
    setBusy('save')
    setNotice(null)
    try {
      const response = await fetch('/api/admin/storage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ driver, r2, b2 })
      })
      const data = (await response.json()) as { error?: string; driver?: string; reason?: string }
      if (!response.ok) throw new Error(data.error ?? 'Could not save that.')
      setNotice({ tone: 'ok', text: `Saved. Files now go to ${data.driver}.` })
      setR2({ accountId: '', accessKeyId: '', secretAccessKey: '', bucket: r2.bucket })
      setB2({ keyId: '', applicationKey: '', bucket: b2.bucket, region: b2.region })
      await load()
    } catch (error) {
      setNotice({ tone: 'bad', text: error instanceof Error ? error.message : 'Could not save that.' })
    } finally {
      setBusy(null)
    }
  }

  async function test(): Promise<void> {
    setBusy('test')
    setNotice(null)
    try {
      const response = await fetch('/api/admin/storage', { method: 'PUT' })
      const data = (await response.json()) as { ok?: boolean; message?: string; error?: string }
      if (!response.ok) throw new Error(data.error ?? 'The test did not run.')
      setNotice({ tone: data.ok ? 'ok' : 'bad', text: data.message ?? '' })
    } catch (error) {
      setNotice({ tone: 'bad', text: error instanceof Error ? error.message : 'The test did not run.' })
    } finally {
      setBusy(null)
    }
  }

  const usage = status?.usage && !('error' in status.usage) ? status.usage : null

  return (
    <div className="card">
      <h2>Where files go</h2>
      {status ? (
        <p className="hint">
          Live driver: <span className="mono">{status.driver}</span> — {status.reason}. Bucket{' '}
          <span className="mono">{status.bucket}</span>
          {status.endpoint ? (
            <>
              , endpoint <span className="mono">{status.endpoint}</span>
            </>
          ) : null}
          .
          {usage ? (
            <>
              {' '}
              Stored:{' '}
              {(['exe', 'image', 'video'] as const)
                .map((kind) => `${usage[kind]?.count ?? 0} ${kind}`)
                .join(' · ')}
              .
            </>
          ) : null}
        </p>
      ) : null}

      {status && status.driver === 'supabase' ? (
        <p className="hint">
          <span className="mono">Note</span> — installers are capped at {status.capsLabel.exe}{' '}
          here. A bigger build needs B2 or R2: fill in the fields below and save, and this
          switches over on its own.
        </p>
      ) : (
        <p className="hint">Reading the current bucket…</p>
      )}

      <div className="field">
        <span className="label">Driver</span>
        <select value={driver} onChange={(event) => setDriver(event.target.value as DriverChoice)}>
          {DRIVERS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        <p className="hint">{DRIVERS.find((entry) => entry.id === driver)?.note}</p>
      </div>

      {driver === 'b2' || driver === 'auto' ? (
        <div className="field">
          <span className="label">
            Backblaze B2{driver === 'auto' ? ' — optional' : ''}
          </span>
          {driver === 'auto' ? (
            <p className="hint">
              Fill these in and save: Automatic will switch to B2 by itself, because it is
              the first bucket with complete credentials. You do not have to select it
              first.
            </p>
          ) : null}
          <input
            placeholder={status?.saved.b2.keyId || 'keyID'}
            value={b2.keyId}
            onChange={(event) => setB2({ ...b2, keyId: event.target.value })}
            autoComplete="off"
            type="text"
          />
          <input
            placeholder={status?.saved.b2.applicationKey || 'applicationKey (the secret, shown once)'}
            value={b2.applicationKey}
            onChange={(event) => setB2({ ...b2, applicationKey: event.target.value })}
            autoComplete="off"
            type="password"
          />
          <input
            placeholder="Bucket name, e.g. indra-loader-files"
            value={b2.bucket}
            onChange={(event) => setB2({ ...b2, bucket: event.target.value })}
            autoComplete="off"
            type="text"
          />
          <input
            placeholder="Region, e.g. us-west-004"
            value={b2.region}
            onChange={(event) => setB2({ ...b2, region: event.target.value })}
            autoComplete="off"
            type="text"
          />
          <p className="hint">
            The key needs <span className="mono">readFiles</span>,{' '}
            <span className="mono">writeFiles</span> and <span className="mono">listFiles</span>{' '}
            on this bucket. Endpoint is derived from the region. The bucket needs a CORS rule
            naming <span className="mono">{status?.origin ?? 'this panel'}</span> — see below.
          </p>
        </div>
      ) : null}

      {driver === 'r2' || driver === 'auto' ? (
        <div className="field">
          <span className="label">
            Cloudflare R2{driver === 'auto' ? ' — optional' : ''}
          </span>
          <input
            placeholder={status?.saved.r2.accountId || 'Account ID'}
            value={r2.accountId}
            onChange={(event) => setR2({ ...r2, accountId: event.target.value })}
            autoComplete="off"
            type="text"
          />
          <input
            placeholder={status?.saved.r2.accessKeyId || 'Access key ID'}
            value={r2.accessKeyId}
            onChange={(event) => setR2({ ...r2, accessKeyId: event.target.value })}
            autoComplete="off"
            type="text"
          />
          <input
            placeholder={status?.saved.r2.secretAccessKey || 'Secret access key'}
            value={r2.secretAccessKey}
            onChange={(event) => setR2({ ...r2, secretAccessKey: event.target.value })}
            autoComplete="off"
            type="password"
          />
          <input
            placeholder="Bucket name"
            value={r2.bucket}
            onChange={(event) => setR2({ ...r2, bucket: event.target.value })}
            autoComplete="off"
            type="text"
          />
        </div>
      ) : null}

      <div className="field">
        <span className="label">Do</span>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => void save()} disabled={busy !== null}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void test()}
            disabled={busy !== null}
          >
            {busy === 'test' ? 'Writing a test object…' : 'Test the bucket'}
          </button>
        </div>
        <p className="hint">
          The test writes one small object, reads it back and deletes it — the only way to
          know a key can actually write. Limits follow the driver:{' '}
          {status
            ? `installers ${status.capsLabel.exe}, images ${status.capsLabel.image}, film ${status.capsLabel.video}`
            : '…'}
          .
        </p>
      </div>

      {notice ? (
        <p className={notice.tone === 'ok' ? 'hint' : 'hint'}>
          <span className="mono">{notice.tone === 'ok' ? 'ok' : 'no'}</span> — {notice.text}
        </p>
      ) : null}
    </div>
  )
}
