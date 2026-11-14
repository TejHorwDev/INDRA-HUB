'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AdminAppRow } from '@/lib/db'
import { parseDescription } from '@/lib/prose'

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
  const [apps, setApps] = useState<AdminAppRow[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ id: string; percent: number; label: string } | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'locked' | 'gated' | 'empty'>('all')

  /*
   * The list, narrowed.
   *
   * Filtering happens here rather than on the server because the whole catalogue is
   * a handful of rows — a round trip per keystroke would be slower and would need a
   * loading state to explain itself.
   */
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return apps.filter((app) => {
      if (needle) {
        const haystack = `${app.name} ${app.keyauth_app_id} ${app.version}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      switch (filter) {
        case 'active':
          return app.status === 'active'
        case 'locked':
          return app.status !== 'active'
        case 'gated':
          return Boolean(app.keyauth_app_id)
        case 'empty':
          // A file that is not in the bucket is not a file: the product has nothing to
          // download, and this is where it should show up.
          return !app.exe_url || app.exe_missing
        default:
          return true
      }
    })
  }, [apps, query, filter])
  const fileInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/apps', { cache: 'no-store' })
      if (response.status === 401) return
      const payload = (await response.json()) as { apps?: AdminAppRow[]; error?: string }
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

  /*
   * Removing a file is two facts at once — the bytes go, and the product stops claiming
   * them. Doing only the first is how a dead installer sat in the table.
   */
  async function removeFile(app: AdminAppRow, kind: 'exe' | 'image'): Promise<void> {
    const what = kind === 'exe' ? 'installer' : 'image'
    const detail = app[kind === 'exe' ? 'exe_missing' : 'image_missing']
      ? `It is already gone from the bucket. Forget the ${what} for ${app.name}?`
      : `Delete the ${what} for ${app.name}? It cannot be undone, and anybody downloading it now will be cut off.`
    if (!window.confirm(detail)) return

    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch(`/api/admin/apps/${app.id}/file?kind=${kind}`, { method: 'DELETE' })
      const payload = (await response.json()) as { error?: string; deleted?: boolean }
      if (!response.ok) {
        setNotice({ tone: 'error', text: payload.error ?? 'Could not delete that file.' })
        return
      }
      setNotice({
        tone: 'ok',
        text: payload.deleted ? `${what[0].toUpperCase()}${what.slice(1)} deleted.` : `Forgotten — the file was already gone.`
      })
      await load()
    } catch {
      setNotice({ tone: 'error', text: 'Could not reach the server.' })
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

  async function upload(app: AdminAppRow, file: File, kind: 'exe' | 'image'): Promise<void> {
    setBusy(true)
    setNotice(null)
    setProgress({ id: app.id, percent: 0, label: kind === 'exe' ? 'Uploading installer' : 'Uploading image' })

    try {
      const targetResponse = await fetch('/api/admin/upload-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          /*
           * The size goes with the request so the server can refuse before any bytes
           * move. A 120 MB installer on a 48 MB bucket used to spend ten minutes
           * uploading and then fail at the far end, which is the worst possible way
           * to learn a file is too big.
           */
          size: file.size
        })
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
        {!loading && apps.length > 0 ? (
          <div className="toolbar">
            <input
              type="search"
              value={query}
              placeholder="Search by name, app id or version…"
              aria-label="Search products"
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="seg">
              {(['all', 'active', 'locked', 'gated', 'empty'] as const).map((key) => (
                <button key={key} type="button" data-active={filter === key} onClick={() => setFilter(key)}>
                  {key === 'empty' ? 'No file' : key[0].toUpperCase() + key.slice(1)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="empty">Loading…</div>
        ) : apps.length === 0 ? (
          <div className="empty">
            Nothing published yet.
            <br />
            Until there is, the loader shows an empty library — which is the truth, not a bug.
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">Nothing matches that filter.</div>
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
              {shown.map((app) => (
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
                    {app.exe_url && app.exe_missing ? (
                      <>
                        <span className="pill warn">file missing</span>
                        <div className="mono">deleted outside the panel</div>
                      </>
                    ) : app.exe_url ? (
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
                      {app.exe_missing ? (
                        <button
                          className="btn small"
                          disabled={busy}
                          title="The file is gone from the bucket. Forget it so the row stops claiming it."
                          onClick={() => void removeFile(app, 'exe')}
                        >
                          Clear
                        </button>
                      ) : null}
                      <button
                        className="btn small"
                        disabled={busy}
                        onClick={() => void patch(app.id, { status: app.status === 'active' ? 'locked' : 'active' })}
                      >
                        {app.status === 'active' ? 'Lock' : 'Unlock'}
                      </button>
                      <button className="btn small" onClick={() => setSelected(app.id === selected ? null : app.id)}>
                        {app.id === selected ? 'Close' : 'Edit'}
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
            <DescriptionField
              key={current.id}
              app={current}
              onSave={(description) => patch(current.id, { description })}
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
              {current.exe_url && current.exe_missing ? (
                <div>
                  <span className="pill warn">file missing</span>
                  <div className="hint" style={{ marginTop: 6 }}>
                    This row still points at a file the bucket no longer has — usually because it was
                    deleted in the Supabase console. Upload a new one, or clear the leftover below.
                  </div>
                </div>
              ) : current.exe_url ? (
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
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <span className="hint">
                {current.exe_missing
                  ? 'The bucket does not have this file.'
                  : current.exe_url
                    ? 'Delete it before uploading next month’s build, or upload over it.'
                    : 'No installer yet.'}
              </span>
              {current.exe_url ? (
                <button
                  type="button"
                  className="btn small danger"
                  disabled={busy}
                  onClick={() => void removeFile(current, 'exe')}
                >
                  {current.exe_missing ? 'Clear the leftover' : 'Delete installer'}
                </button>
              ) : null}
            </div>
          </div>

          <div className="field">
            <span className="label">Card image</span>
            <div className="dropzone" onClick={() => imageInput.current?.click()}>
              {current.image_url && current.image_missing
                ? 'Image missing from the bucket — upload it again'
                : current.image_url
                  ? 'Replace image'
                  : 'Upload an image (PNG or JPG)'}
            </div>
            {current.image_url ? (
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  type="button"
                  className="btn small danger"
                  disabled={busy}
                  onClick={() => void removeFile(current, 'image')}
                >
                  {current.image_missing ? 'Clear the leftover' : 'Delete image'}
                </button>
              </div>
            ) : null}
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


/**
 * The field, its hint, and the preview.
 *
 * Local state on purpose: the preview must react to every keystroke, and the save must
 * not be one request per letter. Typing is local, leaving the field publishes.
 */
function DescriptionField({
  app,
  onSave
}: {
  app: AdminAppRow
  onSave: (description: string) => void
}): React.JSX.Element {
  const [text, setText] = useState(app.description)

  return (
    <>
      <textarea
        id={`desc-${app.id}`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text !== app.description) onSave(text)
        }}
      />
      <div className="hint" style={{ marginTop: 6 }}>
        Separate features with a dash, a pipe or a new line — they become a list in the
        app instead of one long sentence. Capitals are softened there.
      </div>
      {/* Exactly what the loader will draw, so nobody publishes a wall of text. */}
      <DescriptionPreview text={text} />
    </>
  )
}

/**
 * The description, as the loader will draw it.
 *
 * The field is one line and a product's selling points are a list, so the two are never
 * the same shape — and until this existed the only way to find out how it came out was to
 * look at it in the app, on a customer's screen. One parse, the same function the app
 * uses, drawn small.
 */
function DescriptionPreview({ text }: { text: string }): React.JSX.Element | null {
  const prose = parseDescription(text)
  if (!prose.about && prose.features.length === 0) return null

  return (
    <div
      style={{
        marginTop: 10,
        padding: '10px 12px',
        border: '1px solid var(--hairline)',
        borderRadius: 8,
        background: 'rgba(255,255,255,0.02)'
      }}
    >
      <div className="label" style={{ marginBottom: 6 }}>
        In the app
      </div>
      {prose.about ? (
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-2)' }}>{prose.about}</p>
      ) : null}
      {prose.features.length > 0 ? (
        <ul
          style={{
            margin: '8px 0 0',
            padding: 0,
            listStyle: 'none',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '4px 18px',
            fontSize: 11.5,
            color: 'var(--ink-2)'
          }}
        >
          {prose.features.slice(0, 6).map((feature) => (
            <li key={feature} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
              <span
                aria-hidden
                style={{ marginTop: 6, width: 3, height: 3, borderRadius: 999, background: 'var(--ink-3)', flexShrink: 0 }}
              />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {prose.features.length > 6 ? (
        <div className="hint" style={{ marginTop: 6 }}>
          +{prose.features.length - 6} more
        </div>
      ) : null}
    </div>
  )
}
