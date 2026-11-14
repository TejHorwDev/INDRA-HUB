'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/*
 * The sign-in film.
 *
 * One video, on the screen everyone sees before they have signed in. Uploaded
 * here, stored in the bucket, and set as a row — so changing it is a panel action
 * rather than a release.
 *
 * The preview is the same file the app will play. If it does not play here, it
 * will not play there, and both of them say so.
 */

type Notice = { tone: 'ok' | 'error'; text: string } | null

export default function Appearance(): React.JSX.Element {
  const [video, setVideo] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [percent, setPercent] = useState<number | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/config', { cache: 'no-store' })
      const payload = (await response.json()) as { config?: { video?: string } }
      setVideo(payload.config?.video ?? '')
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function send(url: string, method: string, headers: Record<string, string>, file: File): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const request = new XMLHttpRequest()
      request.open(method, url, true)
      for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value)
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) setPercent(Math.min(99, Math.round((event.loaded / event.total) * 100)))
      }
      request.onload = () =>
        request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`Upload failed (${request.status}).`))
      request.onerror = () => reject(new Error('Upload failed. Check the bucket CORS rules.'))
      request.send(file)
    })
  }

  async function upload(file: File): Promise<void> {
    setBusy(true)
    setNotice(null)
    setPercent(0)

    try {
      const targetResponse = await fetch('/api/admin/upload-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'video', filename: file.name, contentType: file.type || 'video/mp4' })
      })
      const target = (await targetResponse.json()) as {
        uploadUrl: string
        method: string
        headers: Record<string, string>
        key: string
        error?: string
      }
      if (!targetResponse.ok) throw new Error(target.error ?? 'Could not sign the upload.')

      await send(target.uploadUrl, target.method, target.headers, file)

      setPercent(100)
      const saved = await fetch('/api/admin/appearance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: target.key })
      })
      const payload = (await saved.json()) as { video?: string; error?: string }
      if (!saved.ok) throw new Error(payload.error ?? 'Could not save the video.')

      setVideo(payload.video ?? '')
      setNotice({ tone: 'ok', text: 'Saved. The next sign-in shows it.' })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Upload failed.' })
    } finally {
      setPercent(null)
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function clear(): Promise<void> {
    setBusy(true)
    try {
      await fetch('/api/admin/appearance', { method: 'DELETE' })
      setVideo('')
      setNotice({ tone: 'ok', text: 'Removed. The sign-in goes back to the animated wash.' })
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return <div className="empty">Loading…</div>

  return (
    <>
      {notice ? <div className={`notice ${notice.tone}`}>{notice.text}</div> : null}

      {video ? (
        <div style={{ marginBottom: 14 }}>
          {/* The actual file, at card width. What you see is what ships. */}
          <video
            src={video}
            muted
            loop
            autoPlay
            playsInline
            style={{
              width: '100%',
              maxWidth: 420,
              borderRadius: 12,
              border: '1px solid var(--hairline)',
              display: 'block',
              background: '#000'
            }}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn small" onClick={() => input.current?.click()} disabled={busy}>
              Replace
            </button>
            <button className="btn small danger" onClick={() => void clear()} disabled={busy}>
              Remove
            </button>
            <span className="mono" style={{ wordBreak: 'break-all' }}>
              {video}
            </span>
          </div>
        </div>
      ) : (
        <div className="dropzone" onClick={() => input.current?.click()}>
          <strong>Upload the sign-in video</strong>
          <div className="hint" style={{ marginTop: 6 }}>
            MP4 (H.264) or WebM, a few MB, looping and silent. It plays behind the sign-in form.
          </div>
          {percent !== null ? (
            <div className="progress">
              <span style={{ width: `${percent}%` }} />
            </div>
          ) : null}
        </div>
      )}

      <input
        ref={input}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
        }}
      />

      {busy && percent !== null && video ? (
        <div className="progress">
          <span style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </>
  )
}
