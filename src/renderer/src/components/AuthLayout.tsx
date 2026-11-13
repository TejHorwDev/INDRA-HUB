import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { PublicAppearance } from '@shared/types'
import { api } from '../lib/api'
import { useLoginVideo } from '../lib/loginVideo'

/**
 * Signed-out shell.
 *
 * One centred column and nothing else. With the administrator's background
 * video installed, that column sits on a veil — a darkening and a blur that
 * both fade out radially — so the film plays behind and around the form with
 * no card, no border and no edge anywhere. The blur and dim values come from
 * the database rather than being fixed here, so the administrator can trade
 * mood against legibility from the panel.
 *
 * Playback is deliberately boring: muted, inline, looped, and started with an
 * explicit play() call as well as the autoplay attribute. If the video cannot
 * be decoded, or its bytes cannot be read, the plain canvas comes back instead
 * of leaving a black hole. Everything decorative is aria-hidden.
 */
export default function AuthLayout({
  children,
  stage
}: {
  children: ReactNode
  /**
   * `stage` widens the column for a screen that is not a form — the opening
   * loader — without changing the video, the veil or the transparency.
   */
  stage?: boolean
}) {
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
    const read = (): void => {
      api.appearance
        .read()
        .then((value) => {
          if (active) setAppearance(value)
        })
        .catch(() => {
          // No video is a perfectly good answer; the canvas stands on its own.
        })
    }

    read()
    // A video installed from the panel on any machine arrives here without a
    // reload; the plain canvas is replaced in place.
    const off = api.workspace.onChange(read)
    return () => {
      active = false
      off()
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

      {/*
        * The veil is its own layer: it carries the darkening and the blur of
        * whatever is behind it, and the radial mask that fades both out. Text
        * sits above it and is never faded.
        */}
      {wantsVideo && <div className="auth-veil" aria-hidden="true" />}

      <div className={`auth-panel stagger${stage ? ' auth-panel--stage' : ''}`}>{children}</div>
    </div>
  )
}
