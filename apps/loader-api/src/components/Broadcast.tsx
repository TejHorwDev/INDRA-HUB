'use client'

import { useEffect, useState } from 'react'

/*
 * The two switches that reach every installed copy of the app.
 *
 * Neither of them is a release: both live in the config table that the loader reads
 * on every launch, so changing one here changes it for everybody the next time they
 * open the app. That makes them powerful and it makes them easy to misuse, so
 * maintenance says what it will do before it does it, and the announcement is
 * capped at two sentences' worth of text rather than a wall of it above a library.
 */

const LIMIT = 280

export default function Broadcast(): React.JSX.Element {
  const [notice, setNotice] = useState('')
  const [maintenance, setMaintenance] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/admin/config', { cache: 'no-store' })
        const payload = (await response.json()) as {
          config?: { notice?: string; maintenance?: string }
        }
        setNotice(payload.config?.notice ?? '')
        setMaintenance(payload.config?.maintenance === '1')
      } finally {
        setLoaded(true)
      }
    })()
  }, [])

  async function save(next: { notice?: string; maintenance?: boolean }): Promise<void> {
    setBusy(true)
    setStatus(null)

    try {
      const response = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next)
      })
      setStatus(response.ok ? 'Saved.' : 'Could not save.')
    } catch {
      setStatus('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return <div className="empty">Loading…</div>

  return (
    <>
      <div className="field">
        <label className="label" htmlFor="notice">
          Announcement
        </label>
        <textarea
          id="notice"
          rows={3}
          value={notice}
          maxLength={LIMIT}
          placeholder="Season 4 installers are being re-signed tonight around 02:00 UTC."
          onChange={(event) => setNotice(event.target.value)}
        />
        <span className="hint">
          Shown above the library in every installed app, on the next launch. Empty
          hides it. {LIMIT - notice.length} characters left.
        </span>
      </div>

      <button
        className="btn primary"
        type="button"
        disabled={busy}
        onClick={() => void save({ notice })}
      >
        {busy ? 'Saving…' : 'Save announcement'}
      </button>

      <hr style={{ border: 0, borderTop: '1px solid var(--hairline)', margin: '20px 0 16px' }} />

      <div className="field">
        <label className="label" htmlFor="maintenance">
          Maintenance mode
        </label>
        <div className="toolbar" style={{ marginBottom: 2 }}>
          <div className="seg">
            <button
              type="button"
              data-active={!maintenance}
              disabled={busy}
              onClick={() => {
                setMaintenance(false)
                void save({ maintenance: false })
              }}
            >
              Open
            </button>
            <button
              type="button"
              data-active={maintenance}
              disabled={busy}
              onClick={() => {
                setMaintenance(true)
                void save({ maintenance: true })
              }}
            >
              Closed
            </button>
          </div>
          <span className="mono" style={{ fontSize: 11 }}>
            {maintenance ? 'showing a closed sign' : 'library visible'}
          </span>
        </div>
        <span className="hint">
          Closed replaces the library with a short notice on the next launch — for
          migrating a bucket, not for a weekend. The announcement above is used as
          the reason it gives, if you wrote one.
        </span>
      </div>

      {status ? (
        <div className={`notice ${status === 'Saved.' ? 'ok' : 'error'}`}>{status}</div>
      ) : null}
    </>
  )
}
