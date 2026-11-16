'use client'

import { useEffect, useRef, useState } from 'react'

/*
 * A product's clip, playing the way the loader plays it.
 *
 * The panel publishes artwork as video, so the shelf is video. That has to be smooth, and
 * smoothness here is a budget: a clip is only worth decoding while somebody can see it.
 *
 * So playback follows the viewport. A clip starts a little before it scrolls into view
 * (200px of margin, enough to have a first frame ready) and pauses the moment it leaves.
 * Scrolling away from the shelf stops every decoder on the page. Hiding the tab stops them
 * too. Nothing is ever decoded off screen, and nothing is ever re-sampled: the video is
 * never scaled or filtered, it only fades in when it is actually playing.
 *
 * The card's name plate sits under it, so a card is finished before a single byte of video
 * has arrived — the clip fades in over it instead of replacing a hole.
 */

export default function Media({
  src,
  dim = 0,
  priority = false
}: {
  src: string
  dim?: number
  /** The first card and a product's own page: fetch straight away. */
  priority?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const [live, setLive] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    /** Whether playback is currently wanted. */
    let wanted = false

    const sync = (): void => {
      if (wanted && !document.hidden) {
        void element.play().catch(() => undefined)
      } else {
        element.pause()
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          wanted = entry.isIntersecting
          // Ask for the clip as it approaches, so the first frame is there when it lands.
          if (wanted && element.preload !== 'auto') element.preload = 'auto'
          sync()
        }
      },
      { threshold: 0.2, rootMargin: '200px 0px' }
    )

    observer.observe(element)

    const onVisibility = (): void => sync()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      element.pause()
    }
  }, [])

  return (
    <span className="media">
      <video
        ref={ref}
        className={live ? 'media-video is-live' : 'media-video'}
        src={src}
        muted
        loop
        playsInline
        preload={priority ? 'auto' : 'metadata'}
        disablePictureInPicture
        disableRemotePlayback
        onPlaying={() => setLive(true)}
        onPause={() => setLive(false)}
        aria-hidden
      />

      {dim ? (
        <span
          className="artwork-dim"
          aria-hidden
          style={{ background: `rgba(5, 5, 6, ${Math.min(90, dim) / 100})` }}
        />
      ) : null}
    </span>
  )
}
