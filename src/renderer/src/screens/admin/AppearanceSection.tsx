import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { PlayIcon, TrashIcon, UploadIcon } from '../../components/icons'
import { useToast } from '../../components/ToastProvider'
import { api, errorMessage } from '../../lib/api'
import { forgetLoginVideo, useLoginVideo } from '../../lib/loginVideo'
import { Badge, SectionHead, formatBytes, formatDateTime } from './shared'
import type { SectionProps } from './shared'

/** Chromium's MediaError codes, in words a person can act on. */
function mediaErrorText(code: number): string {
  switch (code) {
    case 1:
      return 'Playback was aborted.'
    case 2:
      return 'The video stream could not be read.'
    case 3:
      return 'The video is corrupt, or uses a codec this app cannot decode.'
    case 4:
      return 'This format or codec is not supported. Export it as H.264 MP4 or WebM.'
    default:
      return 'The video could not be played.'
  }
}

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

  const [busy, setBusy] = useState<'choose' | 'remove' | 'save' | 'check' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [probe, setProbe] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [videoError, setVideoError] = useState<string | null>(null)
  /** Whether the saved numbers actually left this PC, in plain words. */
  const [share, setShare] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)

  const [blur, setBlur] = useState(appearance.blur)
  const [dim, setDim] = useState(appearance.dim)

  // The overview is the source of truth: after a save or a refresh, the
  // sliders follow the database rather than staying on a stale local copy.
  useEffect(() => {
    setBlur(appearance.blur)
    setDim(appearance.dim)
  }, [appearance.blur, appearance.dim])

  const dirty = blur !== appearance.blur || dim !== appearance.dim

  // The preview plays exactly what the sign-in screen plays: the same bytes,
  // through the same Blob, so a black rectangle here is a real problem and not
  // a difference between two code paths.
  const publicAppearance = useMemo(
    () => ({
      assetId: background?.id ?? null,
      hasVideo: Boolean(background),
      mime: background?.mime ?? null,
      bytes: background?.bytes ?? 0,
      blur,
      dim
    }),
    [background?.id, background?.mime, background?.bytes, blur, dim]
  )
  const { source, error: sourceError } = useLoginVideo(publicAppearance)

  // A new source deserves a clean slate: the previous error (if any) belonged
  // to the file that is no longer on screen.
  useEffect(() => {
    setVideoError(null)
  }, [source?.url])

  async function chooseVideo() {
    setError(null)
    setBusy('choose')
    try {
      const next = await api.admin.chooseLoginVideo()
      if (next) {
        forgetLoginVideo()
        setVideoError(null)
        setProbe(null)
        toast.success('Background video installed. The sign-in screen now plays it.')
        await refresh()
      } else {
        /*
         * The dialog closed without a file. Saying so is not noise: it is the
         * difference between "the app refused my video" and "I never actually
         * handed it one", and the two used to look identical.
         */
        setError('No video was chosen, so nothing changed. The reason is also in Activity.')
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
      forgetLoginVideo()
      setProbe(null)
      setVideoError(null)
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
      /*
       * Saving is local: the numbers are on this PC the moment this returns.
       * Whether the shared row took them is a different question, and it is
       * the one that decides if the change survives a restart anywhere else —
       * so it is asked, out loud, instead of being assumed.
       */
      try {
        const state = await api.workspace.state()
        if (!state.signedIn) {
          setShare({ tone: 'bad', text: 'Saved on this PC only: the workspace account is not signed in.' })
        } else if (!state.owner) {
          setShare({
            tone: 'bad',
            text: `Saved on this PC only: ${state.email ?? 'this account'} does not own the shared workspace, so nothing was published.`
          })
        } else if (state.lastError) {
          setShare({ tone: 'bad', text: `Saved here, but publishing failed: ${state.lastError}` })
        } else if (state.pending) {
          setShare({ tone: 'bad', text: 'Saved here, still being published to the shared workspace.' })
        } else {
          setShare({ tone: 'good', text: 'Saved and published to the shared workspace.' })
        }
      } catch {
        setShare(null)
      }
      await refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  /**
   * Answers "is it actually playing?" with facts instead of a guess: what the
   * main process can read, and what the element itself reports. If the answer
   * is ever no, this line says which half failed.
   */
  async function checkPlayback() {
    setProbe(null)
    setBusy('check')
    try {
      const health = await api.admin.appearanceHealth()
      const parts: string[] = []
      let ok = health.present && health.readable

      if (!health.present) {
        parts.push('no video installed')
      } else if (!health.readable) {
        parts.push('the file is missing from the media folder')
      } else {
        parts.push(
          `file readable · ${formatBytes(health.bytes)} · ${(health.mime ?? '').replace('video/', '').toUpperCase()}`
        )
      }

      const element = previewRef.current
      if (element) {
        // A cold disk can take a moment; do not call it stuck too early.
        if (element.readyState < 2 && !element.error) {
          await new Promise((resolve) => window.setTimeout(resolve, 900))
        }
        if (element.error) {
          ok = false
          parts.push(mediaErrorText(element.error.code))
        } else if (element.readyState >= 1) {
          parts.push(`${element.videoWidth}×${element.videoHeight}`)
          if (Number.isFinite(element.duration) && element.duration > 0) {
            parts.push(`${element.duration.toFixed(1)}s`)
          }
          parts.push(element.paused ? 'paused' : 'playing')
        } else {
          ok = false
          parts.push('the browser never received any frames')
        }
      } else if (health.readable) {
        ok = false
        parts.push('the preview element is not mounted')
      }

      setProbe({ tone: ok ? 'good' : 'bad', text: parts.join(' · ') })
    } catch (caught) {
      setProbe({ tone: 'bad', text: errorMessage(caught) })
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
            {/* Mounted as soon as a file exists, not only once its bytes have
                arrived, so the health check always has an element to read. */}
            {background ? (
              <video
                ref={previewRef}
                className="admin-preview-video"
                src={source?.url}
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                tabIndex={-1}
                disablePictureInPicture
                onError={(event) =>
                  setVideoError(mediaErrorText(event.currentTarget.error?.code ?? 4))
                }
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

          <div className="admin-check">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void checkPlayback()}
              disabled={busy !== null || !background}
            >
              {busy === 'check' ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <PlayIcon size={12} />
              )}
              Check playback
            </button>

            {probe ? (
              <span className={`admin-check-result admin-check-result--${probe.tone}`}>
                {probe.text}
              </span>
            ) : (
              <span className="admin-check-hint">
                Plays the installed file and reports what the browser says about it.
              </span>
            )}
          </div>

          {videoError && (
            <p className="admin-error" role="alert">
              {videoError}
            </p>
          )}

          {sourceError && (
            <p className="admin-error" role="alert">
              {sourceError}
            </p>
          )}

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
            MP4 (H.264) or WebM, up to 96 MB. Keep it short and it loops seamlessly — a ten second
            clip at 1080p is plenty. H.265 / HEVC files are refused when you pick them, because this
            app cannot decode them and they would only ever show a black screen. The file is copied
            into the app&apos;s media folder and recorded in the database; the original on your disk is
            never touched.
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

          {share && (
            <p className={share.tone === 'good' ? 'admin-hint' : 'admin-error'} role="status">
              {share.text}
            </p>
          )}
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
