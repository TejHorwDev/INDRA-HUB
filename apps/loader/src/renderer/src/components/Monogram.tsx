/*
 * A card image, or a deliberate stand-in for one.
 *
 * Products usually have artwork; a product added five minutes ago does not. A
 * grey box would look broken, so the fallback is a silk wash with the product's
 * initial — the same gradient family as the wordmark, at a strength low enough to
 * sit behind content.
 */

const WASHES = [
  'radial-gradient(120% 120% at 20% 0%, rgba(167,155,199,0.22), rgba(20,20,23,1) 62%)',
  'radial-gradient(120% 120% at 80% 10%, rgba(143,134,184,0.20), rgba(20,20,23,1) 64%)',
  'radial-gradient(120% 120% at 50% 100%, rgba(120,112,160,0.20), rgba(20,20,23,1) 66%)',
  'radial-gradient(120% 120% at 10% 90%, rgba(167,155,199,0.18), rgba(20,20,23,1) 60%)'
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
