'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/*
 * The sign-in film — and how it is drawn.
 *
 * One video, behind every screen of the app, uploaded here and stored in the bucket, so
 * changing it is a panel action rather than a release.
 *
 * The preview is the same file the app plays, at the same scale, with the same blur and
 * the same darkening — and with sample content on top of it, because the question these
 * two sliders answer is not "is this pretty" but "can I still read a product name over
 * it". Both of them ship to the app as numbers, and the app applies them to the video
 * element directly.
 */

type Notice = { tone: 'ok' | 'error'; text: string } | null

const BLUR_MAX = 40
const DIM_MAX = 100

export default function Appearance(): React.JSX.Element {
  const [video, setVideo] = useState('')
  const [blur, setBlur] = useState(0)
  const [dim, setDim] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [percent, setPercent] = useState<number | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle')
  const input = useRef<HTMLInputElement>(null)
  const timer = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/config', { cache: 'no-store' })
      const payload = (await response.json()) as {
        config?: { video?: string; film_blur?: string; film_dim?: string }
      }
      setVideo(payload.config?.video ?? '')
      setBlur(Number(payload.config?.film_blur ?? 0) || 0)
      setDim(Number(payload.config?.film_dim ?? 0) || 0)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /*
   * Saving is debounced, because a slider drag is sixty of these a second and the
   * database does not need to hear about fifty-nine of them. The number on screen is
   * always the number that will be saved — the debounce is on the request, not on the
   * state.
   */
  const save = useCallback((nextBlur: number, nextDim: number) => {
    setSaved('saving')
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/admin/config', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            film_blur: String(Math.round(nextBlur * 10) / 10),
            film_dim: String(Math.round(nextDim))
          })
        })
        if (!response.ok) throw new Error('save failed')
        setSaved('saved')
      } catch {
        setSaved('idle')
        setNotice({ tone: 'error', text: 'Could not save the frame. Check the connection and drag again.' })
      }
    }, 350)
  }, [])

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    []
  )

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
      const result = await fetch('/api/admin/appearance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: target.key })
      })
      const payload = (await result.json()) as { video?: string; error?: string }
      if (!result.ok) throw new Error(payload.error ?? 'Could not save the video.')

      setVideo(payload.video ?? '')
      setNotice({ tone: 'ok', text: 'Saved. The next launch shows it.' })
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
      setNotice({ tone: 'ok', text: 'Removed. The app goes back to the animated wash.' })
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return <div className="empty">Loading…</div>

  return (
    <>
      {notice ? <div className={`notice ${notice.tone}`}>{notice.text}</div> : null}

      {/* The film, at window shape, with the real numbers applied and real type on top. */}
      <div className="frame">
        <div className="frame-preview">
          {video ? (
            <video
              className="frame-film"
              src={video}
              muted
              loop
              autoPlay
              playsInline
              style={{
                filter: `blur(${blur}px)`,
                transform: `scale(${1 + Math.min(0.16, blur / 170)})`
              }}
            />
          ) : (
            <span className="frame-wash" />
          )}

          <span className="frame-dim" style={{ opacity: dim / 100 }} />

          <div className="frame-ui">
            <strong>Browse library</strong>
            <span>3 apps available</span>
            <div className="frame-cards">
              <i />
              <i />
              <i />
            </div>
          </div>
        </div>

        <div className="frame-controls">
          <div className="slider-row">
            <span className="label">Blur</span>
            <input
              type="range"
              min={0}
              max={BLUR_MAX}
              step={1}
              value={blur}
              aria-label="Film blur"
              style={{ '--fill': `${(blur / BLUR_MAX) * 100}%` } as React.CSSProperties}
              onChange={(event) => {
                const next = Number(event.target.value)
                setBlur(next)
                save(next, dim)
              }}
            />
            <span className="slider-value">{blur}px</span>
          </div>

          <div className="slider-row">
            <span className="label">Dim</span>
            <input
              type="range"
              min={0}
              max={DIM_MAX}
              step={1}
              value={dim}
              aria-label="Film darkening"
              style={{ '--fill': `${dim}%` } as React.CSSProperties}
              onChange={(event) => {
                const next = Number(event.target.value)
                setDim(next)
                save(blur, next)
              }}
            />
            <span className="slider-value">{dim}%</span>
          </div>

          <div className="row" style={{ marginTop: 4 }}>
            <span className="hint">
              {saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved — applies on the next launch.' : 'Drag to set how the film sits behind the app.'}
            </span>
            <button
              className="row-action"
              style={{ marginLeft: 'auto' }}
              disabled={blur === 0 && dim === 0}
              onClick={() => {
                setBlur(0)
                setDim(0)
                save(0, 0)
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn small" onClick={() => input.current?.click()} disabled={busy}>
          {video ? 'Replace film' : 'Upload film'}
        </button>
        {video ? (
          <>
            <button className="btn small danger" onClick={() => void clear()} disabled={busy}>
              Remove
            </button>
            <span className="mono" style={{ wordBreak: 'break-all' }}>
              {video.split('/').pop()}
            </span>
          </>
        ) : (
          <span className="hint">MP4 (H.264) or WebM, a few MB, silent and looping.</span>
        )}
      </div>

      {percent !== null ? (
        <div className="progress">
          <span style={{ width: `${percent}%` }} />
        </div>
      ) : null}

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
    </>
  )
}
