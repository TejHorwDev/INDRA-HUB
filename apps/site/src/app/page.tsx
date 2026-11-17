import Link from 'next/link'
import HeroFilm from '@/components/HeroFilm'
import Media from '@/components/Media'
import SiteBar from '@/components/SiteBar'
import SiteFoot from '@/components/SiteFoot'
import { downloadTarget, getConfig, getLoader, getProducts, size, type Product } from '@/lib/catalogue'

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

export default async function Home(): Promise<React.JSX.Element> {
  const [products, loader, config] = await Promise.all([getProducts(), getLoader(), getConfig()])

  const download = downloadTarget(loader, config)

  const live = products.filter((product) => product.status === 'active')
  const version = loader.version ? `v${loader.version}` : 'latest'
  const weighted = loader.bytes ? size(loader.bytes) : ''
  /* The file itself, printed under the button — but only once the probe has seen it. */
  const file = loader.verified && loader.name ? loader.name : ''

  /*
   * Artwork is served from the panel's storage host, which is not this one: a handshake and a
   * DNS lookup per visit, four cards that cannot start until it is done, and no way to warm it
   * from the server. React lifts this into the head.
   */
  const mediaOrigin = (() => {
    const source = products.find((product) => product.image)?.image
    if (!source) return ''
    try {
      return new URL(source, 'https://indra-site').origin
    } catch {
      return ''
    }
  })()

  return (
    <>
      <SiteBar />

      {mediaOrigin ? <link rel="preconnect" href={mediaOrigin} /> : null}

      <main id="top">
        <section className="hero">
          {config.video ? (
            <HeroFilm src={config.video} dim={config.filmDim} blur={config.filmBlur} />
          ) : (
            <span className="hero-light" aria-hidden />
          )}

          <div className="wrap">
            <div className="hero-inner fade-up">
              <span className="kicker">
                <i />
                INDRA LOADER {version}
              </span>

              <h1 className="hero-title wordmark">Things I built.</h1>

              <p className="hero-sub">
                Panels, apps and loaders — made to order, hosted, and kept running. This is what
                has shipped so far.
              </p>

              <div className="hero-actions">
                <a className="btn solid lg" href="#library">
                  See the work
                </a>
                <a className="btn ghost lg" href="/login">
                  Sign in
                </a>
              </div>

              <span className="hero-meta">
                {[`${products.length} builds`, 'panels · apps · loaders'].filter(Boolean).join(' · ')}
              </span>

              {config.notice ? <p className="hero-notice">{config.notice}</p> : null}
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
              <p className="count">Built to order</p>
            </div>

            <div className="steps">
              <div className="step">
                <span>01</span>
                <b>You describe the job</b>
                <p>What it has to do, who uses it, what it connects to.</p>
              </div>
              <div className="step">
                <span>02</span>
                <b>It gets built and hosted</b>
                <p>Panel, app, database — deployed under an account you control.</p>
              </div>
              <div className="step">
                <span>03</span>
                <b>It keeps running</b>
                <p>Updates, fixes and changes, without a release cycle every time.</p>
              </div>
            </div>

            <div className="band" id="get">
              <div>
                <h2 className="wordmark">Have something that needs to exist?</h2>
                <p>Tell me what it has to do — I will tell you what it takes.</p>
              </div>

              <div className="band-actions">
                <a className="btn solid lg" href="/login">
                  Sign in
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
