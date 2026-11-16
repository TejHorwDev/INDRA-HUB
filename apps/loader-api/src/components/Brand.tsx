'use client'

import { useEffect, useState } from 'react'

/*
 * The name on the window.
 *
 * A deployment is sometimes sold rather than kept, and a customer who buys a loader does not
 * want to hand their users a product called something else. Three fields and one save, and
 * the loader, the site and this panel all change — the loader picks it up on its next
 * launch, because it reads the brand from the same config endpoint it reads everything else
 * from.
 *
 * Empty is not an error: the mark falls back to the name, and the name falls back to INDRA.
 * So a fresh deployment looks finished before anybody has typed anything.
 */
export default function Brand(): React.JSX.Element {
  const [name, setName] = useState('')
  const [mark, setMark] = useState('')
  const [tagline, setTagline] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/admin/config', { cache: 'no-store' })
        const payload = (await response.json()) as {
          config?: { brand_name?: string; brand_mark?: string; brand_tagline?: string }
        }
        setName(payload.config?.brand_name ?? '')
        setMark(payload.config?.brand_mark ?? '')
        setTagline(payload.config?.brand_tagline ?? '')
      } finally {
        setLoaded(true)
      }
    })()
  }, [])

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setStatus(null)

    try {
      const response = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brand_name: name, brand_mark: mark, brand_tagline: tagline })
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
    <form onSubmit={save}>
      <div className="field">
        <label className="label" htmlFor="brand-name">
          Name
        </label>
        <input
          id="brand-name"
          type="text"
          value={name}
          placeholder="INDRA"
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
        />
        <span className="hint">
          The wordmark on the site, the panel and the loader. Empty falls back to INDRA.
        </span>
      </div>

      <div className="field">
        <label className="label" htmlFor="brand-mark">
          Short mark
        </label>
        <input
          id="brand-mark"
          type="text"
          value={mark}
          placeholder="INDRA"
          maxLength={16}
          onChange={(event) => setMark(event.target.value)}
        />
        <span className="hint">
          What goes in the top-left corner where space is tight. Empty uses the name.
        </span>
      </div>

      <div className="field">
        <label className="label" htmlFor="brand-tagline">
          Tagline
        </label>
        <input
          id="brand-tagline"
          type="text"
          value={tagline}
          placeholder="One loader. Every product."
          maxLength={120}
          onChange={(event) => setTagline(event.target.value)}
        />
        <span className="hint">One line under the name. Empty uses this deployment&apos;s own copy.</span>
      </div>

      {status ? <div className={`notice ${status === 'Saved.' ? 'ok' : 'error'}`}>{status}</div> : null}

      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
