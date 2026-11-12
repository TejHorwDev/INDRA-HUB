import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { PublicAppearance } from '@shared/types'
import { api } from '../lib/api'
import { useLoginVideo } from '../lib/loginVideo'

/**
 * Signed-out shell.
 *
 * Default: one centered column on a quiet, hairlined canvas.
 *
 * When the administrator has installed a background video, the same column
 * sits on a frosted card over a blurred, dimmed, looping video. The blur and
 * dim values come from the database rather than being fixed here, so the
 * administrator can trade mood against legibility from the panel.
 *
 * Playback is deliberately boring: muted, inline, looped, and started with an
 * explicit play() call as well as the autoplay attribute. If the video cannot
 * be decoded, or its bytes cannot be read, the plain canvas comes back instead
 * of leaving a black hole. Everything decorative is aria-hidden.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<PublicAppearance | null>(null)
  const [failed, setFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const { source, error: sourceError } = useLoginVideo(appearance)
  // A bridge that cannot hand over the bytes is as final as a decoder that
  // refuses them: show the plain canvas rather than a black panel behind the
  // card, which is exactly what the administrator reported.
  const wantsVideo = Boolean(appearance?.hasVideo) && !failed && !sourceError
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    let active = true
    api.appearance
      .read()
      .then((value) => {
        if (active) setAppearance(value)
      })
      .catch(() => {
        // No video is a perfectly good answer; the canvas stands on its own.
      })
    return () => {
      active = false
    }
  }, [])

  // Belt and braces: some Chromium paths ignore the attribute alone when the
  // source arrives after mount. A rejected play() is not an error — the first
  // frame stays visible.
  useEffect(() => {
    const element = videoRef.current
    if (!element || !source) return
    element.muted = true
    const attempt = element.play()
    if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {})
  }, [source])

  return (
    <div
      className={`auth-canvas${wantsVideo ? ' auth-canvas--media' : ''}`}
      style={
        wantsVideo
          ? ({
              '--auth-blur': `${appearance?.blur ?? 18}px`,
              '--auth-dim': `${appearance?.dim ?? 46}%`
            } as CSSProperties)
          : undefined
      }
    >
      {wantsVideo && (
        <div className="auth-media" aria-hidden="true">
          {source && (
            <video
              ref={videoRef}
              className="auth-media-video"
              src={source.url}
              autoPlay={!reducedMotion}
              muted
              loop
              playsInline
              preload="auto"
              tabIndex={-1}
              disablePictureInPicture
              onError={() => setFailed(true)}
              onLoadedMetadata={(event) => {
                // A paused element with no frames yet shows nothing; nudging it
                // off zero paints the first frame for reduced-motion users.
                if (reducedMotion && event.currentTarget.paused) {
                  event.currentTarget.currentTime = 0.05
                }
              }}
            />
          )}
          <div className="auth-media-scrim" />
        </div>
      )}

      <div className="auth-panel stagger">{children}</div>
    </div>
  )
}
