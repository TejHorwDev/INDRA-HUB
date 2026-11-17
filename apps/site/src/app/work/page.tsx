import Link from 'next/link'
import SiteBar from '@/components/SiteBar'
import SiteFoot from '@/components/SiteFoot'
import ProductCard from '@/components/ProductCard'
import { getProducts } from '@/lib/catalogue'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'All work — everything built so far',
  description: 'Every panel, app and loader in one place.'
}

/*
 * The whole shelf.
 *
 * The front page shows four because a front page is an argument, not an archive. This is the
 * archive: the same cards, nothing held back.
 */
export default async function Work(): Promise<React.JSX.Element> {
  const products = await getProducts()

  return (
    <>
      <SiteBar />

      <main id="top">
        <section className="hero short">
          <span className="hero-light" aria-hidden />
          <div className="wrap">
            <div className="hero-inner fade-up">
              <span className="kicker">
                <i />
                The work
              </span>
              <h1 className="hero-title wordmark">Everything built so far.</h1>
              <p className="hero-sub">
                {products.length === 0
                  ? 'Nothing published yet.'
                  : `${products.length} ${products.length === 1 ? 'build' : 'builds'} — panels, apps and loaders.`}
              </p>
              <div className="hero-actions">
                <Link className="btn ghost lg" href="/">
                  Back to the front
                </Link>
              </div>
            </div>
          </div>
        </section>

        <div className="wrap">
          <section className="section" id="library">
            {products.length === 0 ? (
              <p className="hero-sub">Nothing published yet — anything added in the panel appears here.</p>
            ) : (
              <div className="shelf">
                {products.map((product, index) => (
                  <ProductCard key={product.id} product={product} first={index === 0} />
                ))}
              </div>
            )}
          </section>

          <SiteFoot />
        </div>
      </main>
    </>
  )
}
