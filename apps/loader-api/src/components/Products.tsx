'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppRow } from '@/lib/db'

/*
 * The catalogue, and the only screen that matters.
 *
 * Three things can be done to a product: describe it, give it an installer, and
 * switch it off. Uploading is the one with a real failure mode, so it reports
 * progress, hashes on the server afterwards, and never claims success before the
 * object is in storage.
 */

type Notice = { tone: 'ok' | 'error' | 'info'; text: string } | null

const EMPTY = {
  name: '',
  description: '',
  version: '1.0.0',
  keyauthAppId: ''
}

function size(bytes: number): string {
  if (!bytes) return '—'
  const mb = bytes / 1048576
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}

export default function Products(): React.JSX.Element {
  const [apps, setApps] = useState<AppRow[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ id: string; percent: number; label: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/apps', { cache: 'no-store' })
      if (response.status === 401) return
      const payload = (await response.json()) as { apps?: AppRow[]; error?: string }
      if (payload.error) setNotice({ tone: 'error', text: payload.error })
      setApps(payload.apps ?? [])
    } catch {
      setNotice({ tone: 'error', text: 'Could not load the catalogue.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const current = apps.find((app) => app.id === selected) ?? null

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setNotice(null)

    try {
      const response = await fetch('/api/admin/apps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft)
      })
      const payload = (await response.json()) as { id?: string; error?: string }
      if (!response.ok || !payload.id) {
        setNotice({ tone: 'error', text: payload.error ?? 'Could not create the product.' })
        return
      }
      setDraft(EMPTY)
      setSelected(payload.id)
      setNotice({ tone: 'ok', text: 'Created. Upload an installer to make it downloadable.' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function patch(id: string, changes: Record<string, unknown>): Promise<void> {
    setBusy(true)
    try {
      const response = await fetch(`/api/admin/apps/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(changes)
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) setNotice({ tone: 'error', text: payload.error ?? 'Could not save.' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string): Promise<void> {
    if (!window.confirm('Remove this product from the catalogue? The uploaded file is kept.')) return
    setBusy(true)
    try {
      await fetch(`/api/admin/apps/${id}`, { method: 'DELETE' })
      if (selected === id) setSelected(null)
      setNotice({ tone: 'ok', text: 'Removed from the catalogue.' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  /** PUT the bytes at the presigned URL, reporting real progress. */
  function send(target: { uploadUrl: string; method: string; headers: Record<string, string> }, file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest()
      request.open(target.method, target.uploadUrl, true)

      for (const [name, value] of Object.entries(target.headers)) request.setRequestHeader(name, value)

      request.upload.onprogress = (event) => {
        if (!event.lengthComputable) return
        const percent = Math.min(99, Math.round((event.loaded / event.total) * 100))
        setProgress((current) => (current ? { ...current, percent } : current))
      }

      request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`Upload failed (${request.status}).`)))
      request.onerror = () => reject(new Error('Upload failed. Check the bucket CORS rules.'))
      request.send(file)
    })
  }

  async function upload(app: AppRow, file: File, kind: 'exe' | 'image'): Promise<void> {
    setBusy(true)
    setNotice(null)
    setProgress({ id: app.id, percent: 0, label: kind === 'exe' ? 'Uploading installer' : 'Uploading image' })

    try {
      const targetResponse = await fetch('/api/admin/upload-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, filename: file.name, contentType: file.type || 'application/octet-stream' })
      })
      const target = (await targetResponse.json()) as {
        uploadUrl: string
        method: string
        headers: Record<string, string>
        key: string
        error?: string
      }
      if (!targetResponse.ok) throw new Error(target.error ?? 'Could not sign the upload.')

      await send(target, file)

      setProgress({ id: app.id, percent: 100, label: 'Verifying' })
      const finalResponse = await fetch('/api/admin/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: app.id, key: target.key, kind })
      })
      const final = (await finalResponse.json()) as { sha256?: string; bytes?: number; error?: string }
      if (!finalResponse.ok) throw new Error(final.error ?? 'The upload could not be verified.')

      setNotice({
        tone: 'ok',
        text:
          kind === 'exe'
            ? `Installer stored — ${size(final.bytes ?? 0)}, SHA-256 ${final.sha256?.slice(0, 16)}…`
            : 'Image stored.'
      })
      await load()
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Upload failed.' })
    } finally {
      setProgress(null)
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
      if (imageInput.current) imageInput.current.value = ''
    }
  }

  return (
    <>
      {notice ? <div className={`notice ${notice.tone === 'info' ? '' : notice.tone}`}>{notice.text}</div> : null}

      <div className="card">
        <h2>Catalogue</h2>
        {loading ? (
          <div className="empty">Loading…</div>
        ) : apps.length === 0 ? (
          <div className="empty">
            Nothing published yet.
            <br />
            Until there is, the loader shows an empty library — which is the truth, not a bug.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Status</th>
                <th>Installer</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => (
                <tr key={app.id}>
                  <td>
                    <strong>{app.name}</strong>
                    <div className="mono">
                      v{app.version}
                      {app.keyauth_app_id ? ` · ${app.keyauth_app_id.slice(0, 12)}` : ' · ungated'}
                    </div>
                  </td>
                  <td>
                    <span className={`pill ${app.status === 'active' ? 'ok' : 'off'}`}>
                      {app.status === 'active' ? 'Active' : 'Locked'}
                    </span>
                  </td>
                  <td>
                    {app.exe_url ? (
                      <>
                        <strong>{size(app.exe_bytes)}</strong>
                        <div className="mono">{app.exe_sha256 ? `${app.exe_sha256.slice(0, 16)}…` : 'no hash'}</div>
                      </>
                    ) : (
                      <span className="mono">no file</span>
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn small" onClick={() => setSelected(app.id === selected ? null : app.id)}>
                        {app.id === selected ? 'Close' : 'Edit'}
                      </button>
                      <button
                        className="btn small"
                        disabled={busy}
                        onClick={() => void patch(app.id, { status: app.status === 'active' ? 'locked' : 'active' })}
                      >
                        {app.status === 'active' ? 'Lock' : 'Unlock'}
                      </button>
                      <button className="btn small danger" disabled={busy} onClick={() => void remove(app.id)}>
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {current ? (
        <div className="card">
          <h2>{current.name}</h2>

          <div className="field">
            <label className="label" htmlFor={`name-${current.id}`}>
              Name
            </label>
            <input
              id={`name-${current.id}`}
              type="text"
              defaultValue={current.name}
              onBlur={(event) => {
                const value = event.target.value.trim()
                if (value && value !== current.name) void patch(current.id, { name: value })
              }}
            />
          </div>

          <div className="field">
            <label className="label" htmlFor={`desc-${current.id}`}>
              Description
            </label>
            <textarea
              id={`desc-${current.id}`}
              defaultValue={current.description}
              onBlur={(event) => {
                if (event.target.value !== current.description) void patch(current.id, { description: event.target.value })
              }}
            />
          </div>

          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label className="label" htmlFor={`version-${current.id}`}>
                Version
              </label>
              <input
                id={`version-${current.id}`}
                type="text"
                defaultValue={current.version}
                onBlur={(event) => {
                  const value = event.target.value.trim() || '1.0.0'
                  if (value !== current.version) void patch(current.id, { version: value })
                }}
              />
            </div>

            <div className="field" style={{ flex: 2, minWidth: 200 }}>
              <label className="label" htmlFor={`keyauth-${current.id}`}>
                INDRA Auth app id
              </label>
              <input
                id={`keyauth-${current.id}`}
                type="text"
                defaultValue={current.keyauth_app_id}
                placeholder="empty means available to anyone signed in"
                onBlur={(event) => {
                  const value = event.target.value.trim()
                  if (value !== current.keyauth_app_id) void patch(current.id, { keyauthAppId: value })
                }}
              />
            </div>
          </div>

          <div className="field">
            <span className="label">Installer</span>
            <div
              className="dropzone"
              data-active={progress?.id === current.id || undefined}
              onClick={() => fileInput.current?.click()}
            >
              {current.exe_url ? (
                <>
                  <strong>{size(current.exe_bytes)}</strong>
                  <div className="mono" style={{ marginTop: 4 }}>
                    {current.exe_sha256 ? `sha256 ${current.exe_sha256.slice(0, 24)}…` : 'no hash published'}
                  </div>
                  <div className="hint" style={{ marginTop: 6 }}>
                    Click to replace. The loader verifies these bytes before installing.
                  </div>
                </>
              ) : (
                <div>
                  <strong>Upload an .exe</strong>
                  <div className="hint" style={{ marginTop: 6 }}>
                    It goes straight to the bucket, then the server hashes it. No size limit here.
                  </div>
                </div>
              )}

              {progress && progress.id === current.id ? (
                <div className="progress">
                  <span style={{ width: `${progress.percent}%` }} />
                </div>
              ) : null}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".exe,application/octet-stream"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void upload(current, file, 'exe')
              }}
            />
          </div>

          <div className="field">
            <span className="label">Card image</span>
            <div className="dropzone" onClick={() => imageInput.current?.click()}>
              {current.image_url ? 'Replace image' : 'Upload an image (PNG or JPG)'}
            </div>
            <input
              ref={imageInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void upload(current, file, 'image')
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="card">
        <h2>New product</h2>
        <form onSubmit={create}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <label className="label" htmlFor="new-name">
                Name
              </label>
              <input
                id="new-name"
                type="text"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Aurora"
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 120 }}>
              <label className="label" htmlFor="new-version">
                Version
              </label>
              <input
                id="new-version"
                type="text"
                value={draft.version}
                onChange={(event) => setDraft({ ...draft, version: event.target.value })}
              />
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="new-description">
              Description
            </label>
            <textarea
              id="new-description"
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="One or two sentences. The card has room for this and nothing more."
            />
          </div>

          <button className="btn primary" type="submit" disabled={busy || !draft.name.trim()}>
            Create
          </button>
        </form>
      </div>
    </>
  )
}
