'use client'

import { useEffect, useRef, useState } from 'react'

/*
 * A product's artwork, playing the way the loader plays it.
 *
 * The panel publishes artwork as a clip or as a still, and the site does not get to have an
 * opinion about which: whatever was uploaded is what the card shows. A still is an <img>, a
 * clip is a <video> — and the extension in the URL is the only thing that decides, because
 * that is how the file was published.
 *
 * Playback is a budget as well as a decision, so it follows the viewport: a clip starts as it
 * approaches the screen (200px of margin, enough time to have a first frame ready) and pauses
 * the moment it leaves. Hiding the tab pauses everything. Nothing is decoded off screen, and
 * nothing is ever re-sampled — the video is never scaled or filtered while it plays.
 *
 * It also has to survive three things that used to stop it dead:
 *
 *  - **No JavaScript at all.** The `autoPlay` attribute is on the element, so the browser
 *    starts the clip while the page is still hydrating instead of waiting for an effect.
 *  - **A blocked `play()`.** Autoplay policies, an audio track that was not muted in time,
 *    a decoder that was busy. The promise is retried on `canplay` and on the first tap.
 *  - **A file that cannot be read.** A broken source hides itself and leaves the card's name
 *    plate in place, instead of leaving a black hole with a broken-media glyph in it.
 *
 * The seat under it — the plate with the initials — is painted first, so a card is finished
 * before a single byte of media has arrived, and the picture fades in over it.
 */

/*
 * Is this artwork moving?
 *
 * The extension answers it when there is one. Artwork can also be a link from anywhere now,
 * and a CDN does not have to end its URLs in `.mp4` — so anything that is not recognisably a
 * still is treated as a clip. The site is video-first; a photograph almost always arrives as
 * `.jpg` or `.webp`, and a `<video>` that cannot read its source falls back to the plate
 * rather than to a broken image.
 */
const STILL = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i

function isVideo(url: string): boolean {
  return /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(url) || !STILL.test(url)
}

export default function Media({
  src,
  dim = 0,
  priority = false
}: {
  src: string
  /** 0–90, straight from the panel: how much black sits over the artwork. */
  dim?: number
  /** The first card and a product's own page: fetch straight away. */
  priority?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const [live, setLive] = useState(false)
  const [broken, setBroken] = useState(false)

  const video = isVideo(src)

  useEffect(() => {
    if (!video) return
    const element = ref.current
    if (!element) return

    /** Whether playback is currently wanted. */
    let wanted = false
    let stopped = false

    const start = (): void => {
      if (stopped || !wanted || document.hidden) return
      const attempt = element.play()
      /*
       * A rejected play() is not an error worth showing: it means the browser said "not
       * yet". `canplay` and the first pointer event both try again.
       */
      if (attempt && typeof attempt.catch === 'function') attempt.catch(() => undefined)
    }

    const sync = (): void => {
      if (wanted && !document.hidden) start()
      else element.pause()
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
      /*
       * A quarter of the card, not a sliver of it.
       *
       * Threshold 0.05 with a 200px margin started four decoders the instant the shelf
       * touched the bottom of the window, while the person was still scrolling past them —
       * which is exactly the moment a decoder costs the most and shows the least. A quarter
       * of the card on screen is the honest definition of "this is being looked at", and the
       * margin only has to cover the moment between the frame arriving and the clip starting.
       */
      { threshold: 0.25, rootMargin: '120px 0px' }
    )

    observer.observe(element)

    const onVisibility = (): void => sync()
    const onCanPlay = (): void => start()
    const onFirstTouch = (): void => start()

    document.addEventListener('visibilitychange', onVisibility)
    element.addEventListener('canplay', onCanPlay)
    window.addEventListener('pointerdown', onFirstTouch, { once: true })
    window.addEventListener('touchstart', onFirstTouch, { once: true })

    // The element may already be on screen before the observer's first callback.
    const box = element.getBoundingClientRect()
    if (box.top < window.innerHeight + 200 && box.bottom > -200) {
      wanted = true
      start()
    }

    return () => {
      stopped = true
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      element.removeEventListener('canplay', onCanPlay)
      window.removeEventListener('pointerdown', onFirstTouch)
      window.removeEventListener('touchstart', onFirstTouch)
      element.pause()
    }
  }, [video, src])

  if (broken) return <span className="media" aria-hidden />

  return (
    <span className="media">
      {video ? (
        <video
          ref={ref}
          className={live ? 'media-video is-live' : 'media-video'}
          src={src}
          muted
          loop
          playsInline
          autoPlay
          preload={priority ? 'auto' : 'metadata'}
          disablePictureInPicture
          disableRemotePlayback
          onPlaying={() => setLive(true)}
          onPause={() => setLive(false)}
          onError={() => setBroken(true)}
          aria-hidden
        />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          className={live ? 'media-still is-live' : 'media-still'}
          src={src}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLive(true)}
          onError={() => setBroken(true)}
          aria-hidden
        />
      )}

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
