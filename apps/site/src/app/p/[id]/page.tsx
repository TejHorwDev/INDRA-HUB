import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import Artwork from '@/components/Artwork'
import SiteBar from '@/components/SiteBar'
import SiteFoot from '@/components/SiteFoot'
import { getLoader, getProduct, INSTALLER_URL, size } from '@/lib/catalogue'

export const revalidate = 60

/*
 * One product, at its own address.
 *
 * The card in the grid has to open something real. This page carries the product's own
 * clip at full bleed, what it actually does — word for word from the panel's description —
 * the build that is live right now, and the one link that installs it.
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
          <Artwork
            src={product.image}
            video={product.imageIsVideo}
            blur={product.artworkBlur}
            dim={product.artworkDim}
            eager
          />
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

              <span className={live ? 'badge' : 'badge off'}>
                <i />
                {live ? 'Live in the loader' : 'Locked'}
              </span>

              <h1 className="metal">{product.name}</h1>

              {product.tagline ? <p className="lede">{product.tagline}</p> : null}

              <div className="meta">
                <span>
                  Build <b>v{product.version}</b>
                </span>
                <span>
                  Loader <b>{loaderVersion}</b>
                </span>
                <span>
                  Windows <b>10 / 11 · x64</b>
                </span>
              </div>
            </div>
          </div>
        </section>

        <div className="shell">
          <section className="section">
            <div className="head">
              <div>
                <p className="label">What it does</p>
                <h2 className="big metal">
                  {product.features.length > 0 ? 'Everything in the build.' : 'In the loader now.'}
                </h2>
              </div>
              <p>
                {live
                  ? 'Install it from inside the loader — signed in as you, no separate download page.'
                  : 'This one is not open on your account yet. The loader will list it the moment it is.'}
              </p>
            </div>

            {product.features.length > 0 ? (
              <ul className="list">
                {product.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            ) : null}

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

            <div className="actions" style={{ justifyContent: 'flex-start' }}>
              <a className="btn primary" href={INSTALLER_URL}>
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
              <a className="btn ghost" href="/#products">
                Back to the lineup
              </a>
            </div>

            <p className="meta" style={{ justifyContent: 'flex-start', marginTop: 22 }}>
              <span>
                {product.name} installs from inside the loader
                {weighted ? ` · loader ${loaderVersion}, ${weighted}` : ` · loader ${loaderVersion}`}
              </span>
            </p>
          </section>

          <SiteFoot />
        </div>
      </main>
    </>
  )
}
