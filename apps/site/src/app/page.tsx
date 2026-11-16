import Artwork from '@/components/Artwork'
import SiteBar from '@/components/SiteBar'
import SiteFoot from '@/components/SiteFoot'
import { getConfig, getLoader, getProducts, INSTALLER_URL, size, type Product } from '@/lib/catalogue'

export const revalidate = 60

/*
 * The front page.
 *
 * It sells in one pass: what this is, proof it exists, what you get, and the button. Every
 * product, clip, version and download link on it comes from the panel, so the page never
 * goes stale and nothing here has to be edited to publish something.
 *
 * Artwork is a clip more often than a still, which is why it goes through <Artwork>: the
 * panel's .webm files in an <img> tag are four empty boxes, and four empty boxes is not a
 * shop window.
 */

const ARROW = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
    <path
      d="M2.5 6h7M6.5 3l3 3-3 3"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const DOWNLOAD = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M8 2v8m0 0 3-3m-3 3L5 7M3 12.5h10"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

function ProductCard({ product }: { product: Product }): React.JSX.Element {
  const live = product.status === 'active'

  return (
    <a className="card" href={`/p/${product.slug}`}>
      <div className="card-media">
        {/* Under the artwork: what the card looks like before a clip has loaded, or if there is none. */}
        <span className="card-fallback" aria-hidden>
          <span>{product.name}</span>
        </span>

        {product.image ? (
          <Artwork src={product.image} video={product.imageIsVideo} blur={product.artworkBlur} dim={product.artworkDim} />
        ) : null}

        <div className="card-top">
          <span className={live ? 'badge' : 'badge off'}>
            <i />
            {live ? 'Live' : 'Locked'}
          </span>
          <span className="chip">v{product.version}</span>
        </div>

        <h3 className="card-title">{product.name}</h3>
      </div>

      <div className="card-body">
        {product.tagline ? <p className="card-tag">{product.tagline}</p> : null}

        {product.features.length > 0 ? (
          <ul className="feats">
            {product.features.slice(0, 6).map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        ) : null}

        <div className="card-foot">
          <span>{live ? 'In the loader' : 'Not available'}</span>
          <span className="card-open">
            {live ? 'Open' : 'Look'}
            {ARROW}
          </span>
        </div>
      </div>
    </a>
  )
}

export default async function Home(): Promise<React.JSX.Element> {
  const [products, loader, config] = await Promise.all([getProducts(), getLoader(), getConfig()])

  const live = products.filter((product) => product.status === 'active')
  const version = loader.version ? `v${loader.version}` : 'latest'
  const weighted = loader.bytes ? size(loader.bytes) : ''
  const film = config.video

  return (
    <>
      <SiteBar />

      <main id="top">
        <section className="hero">
          {film ? (
            <video
              className="hero-media"
              src={film}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              aria-hidden
            />
          ) : null}
          <span className="hero-veil" aria-hidden />
          <span className="hero-glow" aria-hidden />

          <div className="shell">
            <div className="hero-inner">
              <span className="kicker">
                <i />
                {live.length > 0
                  ? `${live.length} product${live.length === 1 ? '' : 's'} live · Windows`
                  : 'Windows · one loader'}
              </span>

              <h1 className="mega metal">
                The best
                <br />
                cheats in
                <br />
                the market.
              </h1>

              <p className="lede">
                One loader, every build. Sign in once and the whole catalogue is there — installed,
                verified against your account, and updated the day it ships.
              </p>

              <div className="actions">
                <a className="btn primary lg" href={INSTALLER_URL}>
                  {DOWNLOAD}
                  Download the loader
                </a>
                <a className="btn ghost lg" href="#products">
                  See the products
                </a>
              </div>

              <div className="meta">
                <span>
                  Build <b>{version}</b>
                </span>
                {weighted ? (
                  <span>
                    Size <b>{weighted}</b>
                  </span>
                ) : null}
                <span>
                  Windows <b>10 / 11 · x64</b>
                </span>
              </div>

              {config.notice ? <p className="notice">{config.notice}</p> : null}
            </div>
          </div>
        </section>

        <div className="shell">
          <div className="rail">
            <div>
              <b>{products.length}</b>
              <span>Products</span>
            </div>
            <div>
              <b>{live.length}</b>
              <span>Live now</span>
            </div>
            <div>
              <b>{version}</b>
              <span>Loader</span>
            </div>
            <div>
              <b>{weighted || '—'}</b>
              <span>Download</span>
            </div>
          </div>

          <section className="section reveal" id="products">
            <div className="head">
              <div>
                <p className="label">The lineup</p>
                <h2 className="big metal">Every build you can install tonight.</h2>
              </div>
              <p>
                Published from the panel and read by the loader — so what is on this page is exactly
                what your account gets.
              </p>
            </div>

            {products.length === 0 ? (
              <p className="lede">
                Nothing is published at the moment. The loader is still available — anything added in
                the panel appears here within a minute.
              </p>
            ) : (
              <div className="grid">
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            )}
          </section>

          <section className="section reveal" id="how">
            <div className="head">
              <div>
                <p className="label">How it works</p>
                <h2 className="big metal">Install once. Then it looks after itself.</h2>
              </div>
              <p>Three steps, then the loader does the rest — updates included, no second download page.</p>
            </div>

            <div className="steps">
              <div className="step">
                <span className="step-n">01</span>
                <h3>Install the loader</h3>
                <p>
                  One executable{weighted ? `, ${weighted}` : ''}. No runtime, no dependencies, no
                  browser tab left open.
                </p>
              </div>
              <div className="step">
                <span className="step-n">02</span>
                <h3>Sign in</h3>
                <p>
                  Your account decides what appears. Nothing you have not paid for is ever listed as
                  available.
                </p>
              </div>
              <div className="step">
                <span className="step-n">03</span>
                <h3>Install anything</h3>
                <p>
                  Each product downloads once, into a folder it owns. When a new build ships, the card
                  offers it.
                </p>
              </div>
            </div>
          </section>

          <section className="cta reveal" id="get">
            <h2 className="metal">Get the loader. Get all of it.</h2>
            <p>
              {version} · Windows 10 and 11 · 64-bit{weighted ? ` · ${weighted}` : ''}
            </p>
            <a className="btn primary lg" href={INSTALLER_URL}>
              {DOWNLOAD}
              Download for Windows
            </a>
          </section>

          <SiteFoot />
        </div>
      </main>
    </>
  )
}
