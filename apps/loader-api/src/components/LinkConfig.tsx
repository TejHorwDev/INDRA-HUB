'use client'

import { useEffect, useState } from 'react'

/*
 * One link. The social fields the first draft had are gone from the app, so they
 * are gone from here too.
 */
export default function LinkConfig(): React.JSX.Element {
  const [website, setWebsite] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/admin/config', { cache: 'no-store' })
        const payload = (await response.json()) as { config?: { website?: string } }
        setWebsite(payload.config?.website ?? '')
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
        body: JSON.stringify({ website })
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
        <label className="label" htmlFor="website">
          Website
        </label>
        <input
          id="website"
          type="url"
          value={website}
          placeholder="https://indra-cheats.com"
          onChange={(event) => setWebsite(event.target.value)}
        />
        <span className="hint">The landing page&apos;s Website button. Empty hides it.</span>
      </div>

      {status ? <div className={`notice ${status === 'Saved.' ? 'ok' : 'error'}`}>{status}</div> : null}

      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
