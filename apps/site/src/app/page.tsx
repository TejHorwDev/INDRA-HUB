import SiteBar from '@/components/SiteBar'
import SiteFoot from '@/components/SiteFoot'
import { getConfig, getLoader, getProducts, INSTALLER_URL, size, type Product } from '@/lib/catalogue'

export const revalidate = 60

/*
 * The site.
 *
 * One page, because there is one thing to say: what is published, and how to get it.
 *
 * The order is the order somebody actually arrives in. They land not knowing what this
 * is — so the headline says it. They want to know it is real — so the catalogue is the
 * second thing on the page, with the artwork the panel publishes. They want to know it is
 * not going to be a mess to install — so the three steps are third. Then the button, one
 * more time, because that is where they are by then.
 *
 * Nothing on this page is invented. Every product, every version, every dimension comes
 * from the same endpoint the desktop app reads, and the installer link is the panel's own
 * pipe. If the catalogue is empty the page says so and still offers the loader.
 */

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

function ProductCard({ product }: { product: Product }): React.JSX.Element {
  return (
    <a className="card" href={`/p/${product.slug}`}>
      <div className="card-art">
        {product.image ? (
          <>
            {/* The panel's own card artwork, with its published blur and dim applied. */}
            <img
              src={product.image}
              alt=""
              loading="lazy"
              style={{
                filter: product.artworkBlur ? `blur(${product.artworkBlur}px)` : undefined,
                transform: product.artworkBlur ? `scale(${1 + Math.min(0.16, product.artworkBlur / 170)})` : undefined
              }}
            />
            {product.artworkDim ? (
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: `rgba(6,6,8,${product.artworkDim / 100})`
                }}
              />
            ) : null}
          </>
        ) : (
          <span className="card-monogram">{initials(product.name)}</span>
        )}
        <span className="card-scrim" />
      </div>

      <div className="card-body">
        <span className="card-name">{product.name}</span>
        {product.description ? <p className="card-line">{product.description}</p> : null}

        <div className="card-foot">
          <span className="card-meta">v{product.version}</span>
          <span className="card-cta">
            {product.status === 'active' ? 'Open' : 'Locked'}
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path
                d="M2.5 6h7M6.5 3l3 3-3 3"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
      </div>
    </a>
  )
}

export default async function Home(): Promise<React.JSX.Element> {
  const [products, loader, config] = await Promise.all([getProducts(), getLoader(), getConfig()])

  const active = products.filter((product) => product.status === 'active').length
  const version = loader.version ? `v${loader.version}` : 'latest'
  const weighted = loader.bytes ? size(loader.bytes) : ''

  return (
    <>
      <SiteBar />

      <main id="top">
        <section className="hero">
          {config.video ? (
            <video className="hero-film" src={config.video} autoPlay muted loop playsInline aria-hidden />
          ) : null}
          <span className="hero-veil" aria-hidden />

          <div className="shell">
            <div className="hero-inner">
              <div>
                <p className="eyebrow">
                  <i />
                  {active > 0 ? `${active} product${active === 1 ? '' : 's'} live` : 'Windows · one loader'}
                </p>

                <h1>
                  Everything
                  <br />
                  we build.
                  <br />
                  <em>One loader.</em>
                </h1>

                <p className="hero-lede">
                  Sign in once and every product is there — installed, verified against your licence,
                  and updated the month it ships. No installers in a folder, no version numbers to
                  chase.
                </p>

                <div className="hero-actions">
                  <a className="button primary" href={INSTALLER_URL}>
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M8 2v8m0 0 3-3m-3 3L5 7M3 12.5h10"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Download for Windows
                  </a>
                  <a className="button ghost" href="#products">
                    See the products
                  </a>
                </div>

                <p className="hero-note">
                  {version}
                  {weighted ? ` · ${weighted}` : ''} · Windows 10 and 11 · 64-bit
                </p>
              </div>

              <dl className="hero-facts">
                <div>
                  <dt>Products</dt>
                  <dd>{products.length}</dd>
                </div>
                <div>
                  <dt>Build</dt>
                  <dd>{version}</dd>
                </div>
                <div>
                  <dt>Sign-in</dt>
                  <dd>INDRA Auth</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        <div className="shell">
          <div className="ribbon">
            <div>
              <b>{products.length}</b>
              <span>Products</span>
            </div>
            <div>
              <b>{active}</b>
              <span>Live now</span>
            </div>
            <div>
              <b>1</b>
              <span>Loader</span>
            </div>
            <div>
              <b>{weighted || '—'}</b>
              <span>Download</span>
            </div>
          </div>

          <section className="section reveal" id="products">
            <p className="section-label">
              The catalogue
              <b>Published from the panel, read by the loader, listed here.</b>
            </p>

            <div>
              <h2 className="section-title">What is published right now.</h2>

              {products.length === 0 ? (
                <p className="empty">
                  Nothing is published at the moment. The loader is still available — anything added
                  appears here within a minute.
                </p>
              ) : (
                <div className="grid">
                  {products.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="section reveal" id="how">
            <p className="section-label">
              How it works
              <b>Three steps, once.</b>
            </p>

            <div>
              <h2 className="section-title">Install once. Then it looks after itself.</h2>

              <div className="steps">
                <div className="step">
                  <span className="step-num">01</span>
                  <h3>Install the loader</h3>
                  <p>
                    One executable, {weighted || 'a few megabytes'}. No runtime, no dependencies, no
                    browser tab left open.
                  </p>
                </div>
                <div className="step">
                  <span className="step-num">02</span>
                  <h3>Sign in</h3>
                  <p>
                    Your account decides what appears. Nothing you have not paid for is ever listed as
                    available.
                  </p>
                </div>
                <div className="step">
                  <span className="step-num">03</span>
                  <h3>Install anything</h3>
                  <p>
                    Each product downloads once, into a folder it owns. When a new build ships, the
                    card offers it.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="close reveal" id="get">
            <div>
              <h2>Get the loader and you have all of it.</h2>
              <p className="hero-note" style={{ marginTop: 18 }}>
                {version} · Windows 10 and 11 · 64-bit{weighted ? ` · ${weighted}` : ''}
              </p>
            </div>

            <a className="button primary" href={INSTALLER_URL}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M8 2v8m0 0 3-3m-3 3L5 7M3 12.5h10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Download for Windows
            </a>
          </section>

          <SiteFoot />
        </div>
      </main>
    </>
  )
}
