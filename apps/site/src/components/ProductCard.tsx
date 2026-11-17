import Link from 'next/link'
import Media from '@/components/Media'
import type { Product } from '@/lib/catalogue'

/*
 * One piece of work, as a card.
 *
 * Lifted out of the home page so the shelf there and the full list at /work cannot drift
 * apart: same plate, same clip, same foot. The only difference is how many of them fit.
 */

const LOCK = (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
    <rect x="3.4" y="7" width="9.2" height="6.2" rx="1.6" stroke="currentColor" strokeWidth="1.2" />
    <path d="M5.6 7V5.4a2.4 2.4 0 0 1 4.8 0V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
)

export default function ProductCard({
  product,
  first = false
}: {
  product: Product
  first?: boolean
}): React.JSX.Element {
  const live = product.status === 'active'
  const initials = product.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <Link className="card" href={`/p/${product.slug}`} aria-label={product.name}>
      {/* The plate: what the card is before a clip has been asked for. */}
      <span className="card-plate" aria-hidden>
        <span>{initials}</span>
      </span>

      {product.image ? <Media src={product.image} dim={product.artworkDim} priority={first} /> : null}

      <span className="card-scrim" aria-hidden />
      {live ? null : (
        <span className="card-lock" aria-hidden>
          {LOCK}
        </span>
      )}

      <span className="card-foot">
        <span className="card-name">{product.name}</span>
        <span className={live ? 'card-state live' : 'card-state off'}>
          <i />
          {live ? 'Available' : 'Locked'}
        </span>
      </span>
    </Link>
  )
}
