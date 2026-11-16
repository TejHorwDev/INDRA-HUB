'use client'

import { useEffect, useState } from 'react'

/*
 * The two links the outside world uses.
 *
 * Both are optional and both degrade to something that already works: an empty website
 * hides the button, and an empty download falls back to this service streaming the newest
 * GitHub release. So nothing here can break the site by being left blank — which matters,
 * because a form that has to be filled in correctly is a form that gets abandoned.
 *
 * The download link is the interesting one. A 116 MB installer streamed by a free instance
 * that has been asleep takes half a minute to begin; a link to a mirror starts immediately
 * and costs nothing. Paste one here (MediaFire, Drive, a CDN, anything) and every Download
 * button on the site — and `/api/loader/installer` — sends people there instead.
 */
export default function LinkConfig(): React.JSX.Element {
  const [website, setWebsite] = useState('')
  const [download, setDownload] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/admin/config', { cache: 'no-store' })
        const payload = (await response.json()) as { config?: { website?: string; download?: string } }
        setWebsite(payload.config?.website ?? '')
        setDownload(payload.config?.download ?? '')
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
        body: JSON.stringify({ website, download })
      })
      if (!response.ok) {
        setStatus('Could not save.')
      } else if (download.trim() && !/^https?:\/\//i.test(download.trim())) {
        setStatus('Saved, but the link is not http(s) — the built-in download is still in use.')
      } else {
        setStatus('Saved.')
      }
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

      <div className="field">
        <label className="label" htmlFor="download">
          Loader download link
        </label>
        <input
          id="download"
          type="url"
          value={download}
          placeholder="https://www.mediafire.com/file/…"
          onChange={(event) => setDownload(event.target.value)}
        />
        <span className="hint">
          Where the site&apos;s Download buttons send people. Empty means the newest GitHub release, streamed
          by this service — slower to start, but always the right build.
        </span>
      </div>

      {status ? <div className={`notice ${status === 'Saved.' ? 'ok' : 'error'}`}>{status}</div> : null}

      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
