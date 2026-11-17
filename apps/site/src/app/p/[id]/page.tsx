import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import Media from '@/components/Media'
import SiteBar from '@/components/SiteBar'
import SiteFoot from '@/components/SiteFoot'
import { getConfig, getLoader, getProduct, getProducts, size } from '@/lib/catalogue'
import { business, contactLink } from '@/lib/ledger/settings'

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

  const [loader, config] = await Promise.all([getLoader(), getConfig()])
  const brand = await business().catch(() => ({ name: '', contact: '', discord: '' }))
  const contact = contactLink(brand)
  const loaderVersion = loader.version ? `v${loader.version}` : 'latest'
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

              {product.image ? <Media src={product.image} dim={product.artworkDim} priority /> : null}
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
                  `${product.name} is one of the things built here — ask about it, or about the one you need.`}
              </p>

              {product.features.length > 0 ? (
                <ul className="chips">
                  {product.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              ) : null}

              <div className="detail-actions">
                <a className="btn solid lg" href={contact.href} target="_blank" rel="noreferrer">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                      d="M13.5 3.2A10.6 10.6 0 0 0 11 2.4l-.3.7a8 8 0 0 1 2.1.8 9.6 9.6 0 0 0-9.6 0 8 8 0 0 1 2.1-.8L5 2.4a10.6 10.6 0 0 0-2.5.8C1.2 5.6.7 8 .8 10.4a10.9 10.9 0 0 0 3.3 1.7l.7-1.1a7 7 0 0 1-1.1-.5l.3-.2a7.7 7.7 0 0 0 8 0l.3.2c-.3.2-.7.4-1.1.5l.7 1.1a10.9 10.9 0 0 0 3.3-1.7c.2-2.8-.5-5.2-2.7-7.2Z"
                      fill="currentColor"
                    />
                    <circle cx="5.9" cy="8.6" r=".9" fill="#0b0b0d" />
                    <circle cx="10.1" cy="8.6" r=".9" fill="#0b0b0d" />
                  </svg>
                  {contact.label}
                </a>
                <Link className="btn ghost lg" href="/work">
                  See all work
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
                {brand.contact || brand.name || 'Built to order'}
              </p>
            </div>
          </div>

          <SiteFoot />
        </div>
      </main>
    </>
  )
}
