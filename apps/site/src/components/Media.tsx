'use client'

import { useEffect, useRef, useState } from 'react'

/*
 * One clip at a time. Never two.
 *
 * The catalogue publishes product artwork as video, and video is the expensive thing on a
 * page: every playing clip is a decoder and a surface being painted, and four of them at
 * once is what makes a shelf feel heavy under the pointer.
 *
 * So this component owns a single global slot: whoever plays last is the only thing
 * playing. Hover a card and its clip starts, the card you left stops. Nothing downloads
 * until it is asked for (`preload="none"`), and nothing is ever decoded off screen.
 *
 * The clip fades in over the card's name plate rather than being revealed by a scale, so
 * the video surface is never resampled — a transformed video is re-rendered every frame,
 * which is the other half of what "laggy" was.
 */

/** The one clip allowed to play. Module scope, shared by every card on the page. */
let playing: HTMLVideoElement | null = null

export default function Media({
  src,
  dim = 0,
  auto = false
}: {
  src: string
  dim?: number
  /** Play without being asked: the first card, and the product's own page. */
  auto?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const [live, setLive] = useState(false)

  const start = (): void => {
    const element = ref.current
    if (!element) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    if (playing && playing !== element) playing.pause()
    playing = element
    void element.play().catch(() => undefined)
  }

  const stop = (): void => {
    if (ref.current) ref.current.pause()
  }

  useEffect(() => {
    if (!auto) return
    const element = ref.current
    if (!element) return
    element.preload = 'auto'
    start()
    return () => {
      element.pause()
      if (playing === element) playing = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto])

  return (
    <span className="media" onPointerEnter={start} onPointerLeave={stop} onFocus={start} onBlur={stop}>
      <video
        ref={ref}
        className={live ? 'media-video is-live' : 'media-video'}
        src={src}
        muted
        loop
        playsInline
        preload={auto ? 'auto' : 'none'}
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
