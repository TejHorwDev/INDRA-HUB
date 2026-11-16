'use client'

import { useEffect, useRef } from 'react'

/*
 * A video that only decodes while it is on screen.
 *
 * The shelf plays clips, and a clip that keeps decoding after it has scrolled out of view
 * is a decoder burning a core for nothing — four cards plus the film behind the hero is
 * five videos, and five videos at 60fps is why a page feels heavy under the hand.
 *
 * So: no autoplay attribute, no preload. An IntersectionObserver starts the clip when a
 * fifth of it is visible and pauses it the moment it is not. Nothing is downloaded until
 * the card is actually looked at, and nothing keeps running once it is past.
 *
 * Reduced motion wins over all of it: those visitors get the first frame and no decoding.
 */

export default function Clip({
  src,
  className,
  style,
  eager = false
}: {
  src: string
  className?: string
  style?: React.CSSProperties
  /** Hero only: fetch the film straight away, since it is what the page opens on. */
  eager?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (typeof window === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // A rejected play() is a browser policy decision, not a failure worth logging.
            void element.play().catch(() => undefined)
          } else {
            element.pause()
          }
        }
      },
      { threshold: 0.2 }
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <video
      ref={ref}
      className={className}
      style={style}
      src={src}
      muted
      loop
      playsInline
      preload={eager ? 'auto' : 'none'}
      aria-hidden
    />
  )
}
