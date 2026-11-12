import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { TrashIcon, UploadIcon } from '../../components/icons'
import { useToast } from '../../components/ToastProvider'
import { api, errorMessage } from '../../lib/api'
import { Badge, SectionHead, formatBytes, formatDateTime } from './shared'
import type { SectionProps } from './shared'

/**
 * Everything about how the signed-out screens look.
 *
 * The administrator picks a video with the native file picker; the main
 * process validates it, copies it into the app's media folder and records it
 * in the database. Blur and dim are the two numbers that decide how much of
 * that video survives under the form, so they are adjustable here with a live
 * preview of the sign-in card instead of a description of one.
 */
export default function AppearanceSection({ overview, refresh }: SectionProps) {
  const toast = useToast()
  const appearance = overview.appearance
  const background = appearance.background

  const [busy, setBusy] = useState<'choose' | 'remove' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const [blur, setBlur] = useState(appearance.blur)
  const [dim, setDim] = useState(appearance.dim)

  // The overview is the source of truth: after a save or a refresh, the
  // sliders follow the database rather than staying on a stale local copy.
  useEffect(() => {
    setBlur(appearance.blur)
    setDim(appearance.dim)
  }, [appearance.blur, appearance.dim])

  const dirty = blur !== appearance.blur || dim !== appearance.dim

  async function chooseVideo() {
    setError(null)
    setBusy('choose')
    try {
      const next = await api.admin.chooseLoginVideo()
      if (next) {
        toast.success('Background video installed. The sign-in screen now plays it.')
        await refresh()
      }
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  async function removeVideo() {
    setError(null)
    setBusy('remove')
    try {
      await api.admin.removeLoginVideo()
      setConfirmRemove(false)
      toast.success('Background video removed. The plain canvas is back.')
      await refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  async function saveTreatment() {
    setError(null)
    setBusy('save')
    try {
      await api.admin.updateAppearanceTreatment({ blur, dim })
      toast.success('Background treatment saved.')
      await refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  const limits = { maxBlur: 40, maxDim: 92 }

  return (
    <>
      <SectionHead
        title="Appearance"
        description="What INDRA HUB looks like before anyone signs in. The video is copied into the app, recorded in the database, and played muted on a loop behind the form."
      />

      <section className="admin-card">
        <div className="admin-card-head">
          <h2>Sign-in background</h2>
          {background ? <Badge tone="good">Live</Badge> : <Badge>Off</Badge>}
        </div>

        <div className="admin-card-body">
          <div
            className="admin-preview"
            style={
              {
                '--preview-blur': `${blur}px`,
                '--preview-dim': `${dim}%`
              } as CSSProperties
            }
          >
            {background ? (
              <video
                className="admin-preview-video"
                src={background.url}
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
              />
            ) : null}

            {background ? <div className="admin-preview-scrim" /> : null}

            {!background && (
              <div className="admin-preview-empty">
                <p className="admin-preview-empty-title">No background video</p>
                <p className="admin-preview-empty-copy">
                  The sign-in and create-account screens use the plain canvas. Choose an MP4 or
                  WebM below and it appears here, exactly as it will behind the form.
                </p>
              </div>
            )}

            {background ? (
              <div className="admin-preview-mock" aria-hidden="true">
                <span className="admin-preview-mock-title">Sign in</span>
                <span className="admin-preview-mock-field" />
                <span className="admin-preview-mock-field admin-preview-mock-field--short" />
                <span className="admin-preview-mock-button" />
              </div>
            ) : null}

            <span className="admin-preview-tag">
              {background ? 'Preview · sign-in screen' : 'Preview · plain canvas'}
            </span>
          </div>

          <div className="admin-form-actions admin-form-actions--start">
            <button
              type="button"
              className="btn btn-primary w-auto"
              onClick={() => void chooseVideo()}
              disabled={busy !== null}
            >
              {busy === 'choose' ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <UploadIcon size={14} />
              )}
              {busy === 'choose' ? 'Copying…' : background ? 'Replace video…' : 'Choose video…'}
            </button>

            {background && (
              <button
                type="button"
                className="btn btn-ghost w-auto"
                onClick={() => setConfirmRemove(true)}
                disabled={busy !== null}
              >
                <TrashIcon size={14} />
                Remove
              </button>
            )}
          </div>

          {background && (
            <dl className="admin-facts">
              <div>
                <dt>File</dt>
                <dd title={background.originalName}>{background.originalName}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{formatBytes(background.bytes)}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{background.mime.replace('video/', '').toUpperCase()}</dd>
              </div>
              <div>
                <dt>Installed</dt>
                <dd>{formatDateTime(background.createdAt)}</dd>
              </div>
            </dl>
          )}

          {error && (
            <p className="admin-error" role="alert">
              {error}
            </p>
          )}

          <p className="admin-hint">
            MP4 (H.264) or WebM, up to 200 MB. Keep it short and it loops seamlessly — a ten second
            clip at 1080p is plenty. The file is copied into the app&apos;s media folder and recorded
            in the database; the original on your disk is never touched.
          </p>
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <h2>Video treatment</h2>
          {dirty && <span className="admin-status admin-status--accent">Unsaved changes</span>}
        </div>

        <div className="admin-card-body">
          <div className="admin-slider-grid">
            <label className="admin-slider">
              <span className="admin-slider-head">
                <span className="admin-slider-label">Blur</span>
                <span className="admin-slider-value">{blur}px</span>
              </span>
              <input
                type="range"
                min={0}
                max={limits.maxBlur}
                step={1}
                value={blur}
                onChange={(event) => setBlur(Number(event.target.value))}
                disabled={busy !== null}
                style={{ '--fill': `${(blur / limits.maxBlur) * 100}%` } as CSSProperties}
              />
              <span className="admin-slider-hint">
                Softens the footage so the form is the thing in focus. The preview above follows the
                slider before you save.
              </span>
            </label>

            <label className="admin-slider">
              <span className="admin-slider-head">
                <span className="admin-slider-label">Dim</span>
                <span className="admin-slider-value">{dim}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={limits.maxDim}
                step={1}
                value={dim}
                onChange={(event) => setDim(Number(event.target.value))}
                disabled={busy !== null}
                style={{ '--fill': `${(dim / limits.maxDim) * 100}%` } as CSSProperties}
              />
              <span className="admin-slider-hint">
                Darkens the video. Above 70% only the movement reads through — the safest setting
                if the footage is busy or bright.
              </span>
            </label>
          </div>

          <div className="admin-form-actions">
            <button
              type="button"
              className="btn btn-ghost w-auto"
              onClick={() => {
                setBlur(appearance.blur)
                setDim(appearance.dim)
              }}
              disabled={!dirty || busy !== null}
            >
              Discard
            </button>
            <button
              type="button"
              className="btn btn-primary w-auto"
              onClick={() => void saveTreatment()}
              disabled={!dirty || busy !== null}
            >
              {busy === 'save' && <span className="spinner" aria-hidden="true" />}
              {busy === 'save' ? 'Saving…' : 'Save treatment'}
            </button>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={confirmRemove}
        title="Remove the background video"
        confirmLabel="Remove"
        pending={busy === 'remove'}
        error={null}
        onCancel={() => {
          if (busy !== 'remove') setConfirmRemove(false)
        }}
        onConfirm={() => void removeVideo()}
      >
        <p>
          The file is deleted from the app&apos;s media folder and the sign-in screen returns to the
          plain canvas. Nothing else changes.
        </p>
      </ConfirmDialog>
    </>
  )
}
