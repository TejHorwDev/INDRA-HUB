import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import Media from '@/components/Media'
import SiteBar from '@/components/SiteBar'
import SiteFoot from '@/components/SiteFoot'
import { getLoader, getProduct, getProducts, size } from '@/lib/catalogue'

export const revalidate = 10

/*
 * One product — the loader's detail screen, with room to breathe.
 *
 * Artwork square on the left at the size the app draws it, name and the one line that
 * says what it is on the right, the build's features as chips, and the single action this
 * page exists for. No paragraphs: the app does not have paragraphs either.
 */

type Params = { params: Promise<{ id: string }> }

/*
 * Every product is built ahead of time.
 *
 * A product page that renders on request has to ask the panel for the catalogue before it
 * can answer, and when that API is cold the click sits there — which is what "the page
 * takes ages to change" was. Prerendered, it is a file on a CDN and the navigation is
 * instant. Anything published after this build still resolves, on demand.
 */
export async function generateStaticParams(): Promise<Array<{ id: string }>> {
  const products = await getProducts()
  return products.map((product) => ({ id: product.slug }))
}

export const dynamicParams = true

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
        <div className="wrap">
          <div className="detail">
            <div className="detail-art">
              <span className="card-plate" aria-hidden>
                <span>{product.name.slice(0, 2).toUpperCase()}</span>
              </span>

              {product.image && product.imageIsVideo ? (
                <Media src={product.image} dim={product.artworkDim} priority />
              ) : null}
            </div>

            <div>
              <Link className="back" href="/#library">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path
                    d="M7.5 2.5 4 6l3.5 3.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                The library
              </Link>

              <h1 className="wordmark">{product.name}</h1>

              <p className="tagline">
                {product.tagline ||
                  `${product.name} installs from inside the loader — signed in as you, updated when a new build ships.`}
              </p>

              {product.features.length > 0 ? (
                <ul className="chips">
                  {product.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              ) : null}

              <div className="detail-actions">
                <a className="btn solid lg" href={loader.href} title={loader.name ?? undefined}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                      d="M8 2v8m0 0 3-3m-3 3L5 7M3 12.5h10"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Download the loader
                </a>
                <Link className="btn ghost lg" href="/#library">
                  Back to the library
                </Link>
              </div>

              <dl className="facts">
                <div>
                  <dt>Build</dt>
                  <dd>v{product.version}</dd>
                </div>
                <div>
                  <dt>Loader</dt>
                  <dd>{loaderVersion}</dd>
                </div>
                <div>
                  <dt>Platform</dt>
                  <dd>Windows 10 / 11</dd>
                </div>
                <div>
                  <dt>Access</dt>
                  <dd>{live ? 'Available' : 'Locked'}</dd>
                </div>
              </dl>

              <p className="hero-meta" style={{ marginTop: 18, display: 'block' }}>
                {[`Loader ${loaderVersion}`, loader.name ?? '', weighted].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>

          <SiteFoot />
        </div>
      </main>
    </>
  )
}
