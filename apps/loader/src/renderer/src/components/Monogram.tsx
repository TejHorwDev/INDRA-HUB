/*
 * A card image, or a deliberate stand-in for one.
 *
 * Products usually have artwork; a product added five minutes ago does not. A
 * grey box would look broken, so the fallback is a silk wash with the product's
 * initial — the same gradient family as the wordmark, at a strength low enough to
 * sit behind content.
 */

import { useState } from 'react'

const WASHES = [
  /*
   * The placeholder behind a product with no artwork: one soft light from a corner,
   * falling into the card's own black. Four variants, so a library of unknown
   * products does not look like four copies of the same rectangle.
   */
  'radial-gradient(120% 120% at 20% 0%, rgba(255,255,255,0.13), rgba(16,16,19,1) 62%)',
  'radial-gradient(120% 120% at 80% 10%, rgba(255,255,255,0.1), rgba(16,16,19,1) 64%)',
  'radial-gradient(120% 120% at 50% 100%, rgba(255,255,255,0.11), rgba(16,16,19,1) 66%)',
  'radial-gradient(120% 120% at 10% 90%, rgba(255,255,255,0.09), rgba(16,16,19,1) 60%)'
]

function hash(value: string): number {
  let result = 0
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) % 100_000
  }
  return result
}

/**
 * A card whose artwork is a video, not a picture.
 *
 * A short loop says more about a product than any single frame of it, and it is the same
 * idea as a GIF with a file that is a tenth of the size. The extension decides — nothing
 * else needs to know, and the panel accepts both.
 */
const MOVING = /\.(mp4|webm|mov|m4v)(\?|#|$)/i

export function isMovingArtwork(image: string): boolean {
  return MOVING.test(image.trim())
}

interface Props {
  name: string
  image: string
  className?: string
  /** Type scale for the initial, so one component serves a card and a preview. */
  initialClassName?: string
  /** Pixels of blur over the artwork, 0–40. Published per product by the panel. */
  blur?: number
  /** Percent of dark over the artwork, 0–100. */
  dim?: number
}

export default function Monogram({
  name,
  image,
  className = '',
  initialClassName = 'text-[38px]',
  blur = 0,
  dim = 0
}: Props): React.JSX.Element {
  /*
   * Artwork that cannot be drawn is worse than no artwork.
   *
   * A card whose file was deleted, or whose video the machine's codecs refuse, used to be
   * a black rectangle — indistinguishable from a broken app in a grid of working ones.
   * The wash and the initial are already the honest fallback for "no artwork yet", so a
   * failure lands there instead of on a void.
   */
  const [failed, setFailed] = useState(false)
  const usable = image && !failed

  if (usable) {
    /*
     * The frame the panel sets for this card.
     *
     * The artwork is softened and scaled by as much as it is softened — a blurred picture
     * inside a sharp edge reads as a bug — and the darkening is its own layer above it,
     * because a `filter: brightness()` would drag the name down with the picture, and the
     * name is the one thing on a card that has to stay white.
     */
    const scale = 1 + Math.min(0.16, blur / 100)
    const frame = blur
      ? { filter: `blur(${blur}px)`, transform: `scale(${scale})` }
      : undefined

    return (
      <div className={`relative h-full w-full overflow-hidden ${className}`}>
        {/*
         * A video card: muted, inline, looping — a moving picture where a still one would
         * be, with no controls and nothing to click. It is scenery, exactly like the film
         * behind the window, and the same rules apply: it must never ask for a gesture.
         */}
        {isMovingArtwork(image) ? (
          <video
            src={image}
            muted
            loop
            autoPlay
            playsInline
            preload="auto"
            tabIndex={-1}
            disablePictureInPicture
            onError={() => setFailed(true)}
            style={frame}
            className="h-full w-full object-cover"
          />
        ) : (
          /*
           * A plain `<img>`, which is also what animates a GIF or an animated WebP: the
           * format decides, not the component. `decoding="async"` keeps a large card from
           * blocking the paint of the grid around it.
           */
          <img
            src={image}
            alt=""
            draggable={false}
            decoding="async"
            onError={() => setFailed(true)}
            style={frame}
            className="h-full w-full object-cover"
          />
        )}

        {dim > 0 ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: '#060608', opacity: dim / 100 }}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={`grid h-full w-full place-items-center ${className}`}
      style={{ background: WASHES[hash(name) % WASHES.length] }}
    >
      <span className={`wordmark font-semibold ${initialClassName}`}>
        {name.slice(0, 1).toUpperCase()}
      </span>
    </div>
  )
}
