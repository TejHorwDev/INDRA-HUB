'use client'

import { useEffect, useRef, useState } from 'react'

/*
 * The backdrop film.
 *
 * It is the one decoder on the page that starts without being asked, because a backdrop that
 * waits for an observer has already missed the moment it was there for. But it is also the
 * most expensive thing on the page — 1920×1080, full bleed, behind everything — and it used
 * to keep playing for as long as the tab was open, including while somebody was scrolling the
 * shelf two screens below it. That is a frame of video decoded per frame of scroll, for a
 * picture nobody can see.
 *
 * So it plays while the hero is on screen, pauses the moment it is not, and pauses when the
 * tab is hidden. Same treatment the cards get, for the same reason.
 */

export default function HeroFilm({
  src,
  dim = 0,
  blur = 0
}: {
  src: string
  /** 0–85, from the panel: how much black sits over the film. */
  dim?: number
  /** 0–100, from the panel. Applied to the container, never to a playing frame. */
  blur?: number
}): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    let visible = true
    let stopped = false

    const start = (): void => {
      if (stopped || !visible || document.hidden) return
      const attempt = element.play()
      if (attempt && typeof attempt.catch === 'function') attempt.catch(() => undefined)
    }

    const sync = (): void => {
      if (visible && !document.hidden) start()
      else element.pause()
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible = entry.isIntersecting
          sync()
        }
      },
      { threshold: 0 }
    )

    observer.observe(element)

    const onVisibility = (): void => sync()
    document.addEventListener('visibilitychange', onVisibility)
    element.addEventListener('canplay', start)

    start()

    return () => {
      stopped = true
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      element.removeEventListener('canplay', start)
      element.pause()
    }
  }, [src])

  // A film that cannot be read is not a hole: the same light the hero had without it.
  if (failed) return <span className="hero-light" aria-hidden />

  return (
    <div
      className="hero-film"
      aria-hidden
      style={blur ? { filter: `blur(${Math.min(40, blur) / 2}px)`, transform: 'scale(1.04)' } : undefined}
    >
      <video
        ref={ref}
        src={src}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        onError={() => setFailed(true)}
      />
      <span
        className="hero-film-dim"
        style={{ background: `rgba(6, 6, 8, ${Math.min(85, dim) / 100})` }}
      />
      <span className="hero-veil" />
    </div>
  )
}
