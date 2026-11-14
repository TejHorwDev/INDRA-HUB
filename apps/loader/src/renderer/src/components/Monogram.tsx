/*
 * A card image, or a deliberate stand-in for one.
 *
 * Products usually have artwork; a product added five minutes ago does not. A
 * grey box would look broken, so the fallback is a silk wash with the product's
 * initial — the same gradient family as the wordmark, at a strength low enough to
 * sit behind content.
 */

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

interface Props {
  name: string
  image: string
  className?: string
  /** Type scale for the initial, so one component serves a card and a preview. */
  initialClassName?: string
}

export default function Monogram({
  name,
  image,
  className = '',
  initialClassName = 'text-[38px]'
}: Props): React.JSX.Element {
  if (image) {
    return (
      <img
        src={image}
        alt=""
        draggable={false}
        className={`h-full w-full object-cover ${className}`}
      />
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
