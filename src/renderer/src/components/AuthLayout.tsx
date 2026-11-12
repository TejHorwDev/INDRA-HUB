import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { PublicAppearance } from '@shared/types'
import { api } from '../lib/api'

/**
 * Signed-out shell.
 *
 * Default: one centered column on a quiet, hairlined canvas.
 *
 * When the administrator has installed a background video, the same column
 * sits on a frosted card over a blurred, dimmed, looping video. The blur and
 * dim values come from the database rather than being fixed here, so the
 * administrator can trade mood against legibility from the panel. Everything
 * decorative is aria-hidden, and a video that fails to decode quietly falls
 * back to the plain canvas instead of leaving a black hole.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<PublicAppearance | null>(null)
  const [failed, setFailed] = useState(false)

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

  const video = appearance?.url && !failed ? appearance : null
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  return (
    <div
      className={`auth-canvas${video ? ' auth-canvas--media' : ''}`}
      style={
        video
          ? ({
              '--auth-blur': `${appearance?.blur ?? 18}px`,
              '--auth-dim': `${appearance?.dim ?? 58}%`
            } as CSSProperties)
          : undefined
      }
    >
      {video && (
        <div className="auth-media" aria-hidden="true">
          <video
            className="auth-media-video"
            src={appearance?.url ?? undefined}
            autoPlay={!reducedMotion}
            muted
            loop
            playsInline
            preload="auto"
            tabIndex={-1}
            disablePictureInPicture
            onError={() => setFailed(true)}
          />
          <div className="auth-media-scrim" />
        </div>
      )}

      <div className="auth-panel stagger">{children}</div>
    </div>
  )
}
