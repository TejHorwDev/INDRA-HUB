import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import SiteBar from '@/components/SiteBar'
import SiteFoot from '@/components/SiteFoot'
import { getLoader, getProduct, INSTALLER_URL, size } from '@/lib/catalogue'

export const revalidate = 60

/*
 * A product page.
 *
 * The card in the grid has to open something — a card that quietly jumps to the download
 * band is a promise the page does not keep. So each product has its own address, its art
 * at full bleed, and the one fact that matters on it: what build is live.
 *
 * Everything here comes from the panel. A product that is unpublished stops resolving; a
 * renamed one renames here; a new version is live on this page within the minute.
 */

type Params = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const product = await getProduct((await params).id)
  if (!product) return { title: 'Not found — INDRA' }

  return {
    title: `${product.name} — INDRA`,
    description:
      product.description ||
      `${product.name}, build ${product.version}, delivered and kept current by the INDRA loader.`,
    openGraph: {
      title: product.name,
      description: product.description || `Build ${product.version}, via the INDRA loader.`,
      type: 'website'
    }
  }
}

export default async function ProductPage({ params }: Params): Promise<React.JSX.Element> {
  const handle = (await params).id
  const product = await getProduct(handle)
  if (!product) notFound()

  // An old id link lands on the readable address rather than on two spellings of one page.
  if (handle !== product.slug) redirect(`/p/${product.slug}`)

  const loader = await getLoader()
  const loaderVersion = loader.version ? `v${loader.version}` : 'latest'
  const weighted = loader.bytes ? size(loader.bytes) : ''
  const live = product.status === 'active'

  return (
    <>
      <SiteBar />

      <main>
        <section className="plate">
          {product.image ? (
            <>
              <img
                className="plate-art"
                src={product.image}
                alt=""
                style={{
                  filter: product.artworkBlur ? `blur(${Math.max(0, product.artworkBlur)}px)` : undefined,
                  transform: product.artworkBlur
                    ? `scale(${1 + Math.min(0.16, product.artworkBlur / 170)})`
                    : undefined
                }}
              />
              {product.artworkDim ? (
                <span
                  className="plate-dim"
                  aria-hidden
                  style={{ background: `rgba(6, 6, 8, ${product.artworkDim / 100})` }}
                />
              ) : null}
            </>
          ) : (
            <span className="plate-mono" aria-hidden>
              {product.name
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((word) => word[0]?.toUpperCase() ?? '')
                .join('')}
            </span>
          )}
          <span className="plate-veil" aria-hidden />

          <div className="shell">
            <div className="plate-inner">
              <a className="crumb" href="/#products">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path
                    d="M7.5 2.5 4 6l3.5 3.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                All products
              </a>

              <p className="eyebrow">
                <i style={live ? undefined : { background: 'var(--ink-4)', animation: 'none' }} />
                {live ? 'Live in the loader' : 'Locked'}
              </p>

              <h1 className="plate-name">{product.name}</h1>

              <p className="hero-note">
                Build v{product.version} · Windows 10 and 11 · 64-bit
              </p>
            </div>
          </div>
        </section>

        <div className="shell">
          <section className="section">
            <p className="section-label">
              The product
              <b>Published from the INDRA panel.</b>
            </p>

            <div>
              <p className="lede">
                {product.description ||
                  `${product.name} ships through the loader. Install it once and the next build arrives on its own — no second download page to remember.`}
              </p>

              <dl className="facts">
                <div>
                  <dt>Current build</dt>
                  <dd>v{product.version}</dd>
                </div>
                <div>
                  <dt>Delivery</dt>
                  <dd>INDRA loader {loaderVersion}</dd>
                </div>
                <div>
                  <dt>Platform</dt>
                  <dd>Windows 10 / 11 · x64</dd>
                </div>
                <div>
                  <dt>Access</dt>
                  <dd>{live ? 'With your account' : 'Not available'}</dd>
                </div>
              </dl>

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
                  Download the loader
                </a>
                <a className="button ghost" href="/#products">
                  Back to the catalogue
                </a>
              </div>

              <p className="hero-note">
                {product.name} installs from inside the loader, signed in as you
                {weighted ? ` · loader ${loaderVersion}, ${weighted}` : ` · loader ${loaderVersion}`}
              </p>
            </div>
          </section>

          <SiteFoot />
        </div>
      </main>
    </>
  )
}
