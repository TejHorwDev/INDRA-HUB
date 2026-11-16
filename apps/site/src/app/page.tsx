import Link from 'next/link'
import Media from '@/components/Media'
import SiteBar from '@/components/SiteBar'
import SiteFoot from '@/components/SiteFoot'
import { getLoader, getProducts, size, type Product } from '@/lib/catalogue'

export const revalidate = 10

/*
 * The front page.
 *
 * It is the loader with more air: matte black, a shelf of artwork, one small state line
 * under each name, four sentences of copy. No background video — a full-bleed film behind
 * the type was the single most expensive thing on the page and the least of what it said.
 *
 * The clips are the products' own, published from the panel and played by <Media>: they
 * start as they arrive on screen and stop the moment they leave. Nothing on this page is
 * written down anywhere — the catalogue, the lock states and the loader's build are read
 * from the panel every ten seconds, so publishing in the panel publishes here.
 */

const DOWNLOAD = (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M8 2v8m0 0 3-3m-3 3L5 7M3 12.5h10"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const LOCK = (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
    <rect x="3.4" y="7" width="9.2" height="6.2" rx="1.6" stroke="currentColor" strokeWidth="1.2" />
    <path d="M5.6 7V5.4a2.4 2.4 0 0 1 4.8 0V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
)

function Card({ product, first }: { product: Product; first: boolean }): React.JSX.Element {
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

      {product.image && product.imageIsVideo ? (
        <Media src={product.image} dim={product.artworkDim} priority={first} />
      ) : null}

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

export default async function Home(): Promise<React.JSX.Element> {
  const [products, loader] = await Promise.all([getProducts(), getLoader()])

  const live = products.filter((product) => product.status === 'active')
  const version = loader.version ? `v${loader.version}` : 'latest'
  const weighted = loader.bytes ? size(loader.bytes) : ''
  /* The file itself, printed under the button — but only once the probe has seen it. */
  const file = loader.verified && loader.name ? loader.name : ''

  return (
    <>
      <SiteBar />

      <main id="top">
        <section className="hero">
          <span className="hero-light" aria-hidden />

          <div className="wrap">
            <div className="hero-inner fade-up">
              <span className="kicker">
                <i />
                INDRA LOADER {version}
              </span>

              <h1 className="hero-title wordmark">Browse the library.</h1>

              <p className="hero-sub">
                Every build we publish, in one window — installed, kept current, and tied to your
                account.
              </p>

              <div className="hero-actions">
                <a className="btn solid lg" href={loader.href} title={loader.name ?? undefined}>
                  {DOWNLOAD}
                  Download for Windows
                </a>
                <a className="btn ghost lg" href="#library">
                  See the library
                </a>
              </div>

              <span className="hero-meta">
                {[file, weighted, 'Windows 10 / 11 · 64-bit'].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
        </section>

        <div className="wrap">
          <section className="section" id="library">
            <div className="head">
              <p className="label">The library</p>
              <p className="count">
                {products.length} product{products.length === 1 ? '' : 's'} · {live.length} available
              </p>
            </div>

            {products.length === 0 ? (
              <p className="hero-sub">
                Nothing published yet. The loader is still available, and anything added in the panel
                appears here within a minute.
              </p>
            ) : (
              <div className="shelf">
                {products.map((product, index) => (
                  <Card key={product.id} product={product} first={index === 0} />
                ))}
              </div>
            )}
          </section>

          <section className="section" id="how">
            <div className="head">
              <p className="label">How it works</p>
              <p className="count">Three steps</p>
            </div>

            <div className="steps">
              <div className="step">
                <span>01</span>
                <b>Install the loader</b>
                <p>One executable{weighted ? `, ${weighted}` : ''}. Nothing else.</p>
              </div>
              <div className="step">
                <span>02</span>
                <b>Sign in</b>
                <p>Your account decides what appears.</p>
              </div>
              <div className="step">
                <span>03</span>
                <b>Open anything</b>
                <p>Each build installs once and updates itself.</p>
              </div>
            </div>

            <div className="band" id="get">
              <div>
                <h2 className="wordmark">Get the loader.</h2>
                <p>
                  {version}
                  {weighted ? ` · ${weighted}` : ''} · Windows 10 / 11 · 64-bit
                </p>
              </div>

              <div className="band-actions">
                <a className="btn solid lg" href={loader.href} title={loader.name ?? undefined}>
                  {DOWNLOAD}
                  Download
                </a>
              </div>
            </div>
          </section>

          <SiteFoot />
        </div>
      </main>
    </>
  )
}
