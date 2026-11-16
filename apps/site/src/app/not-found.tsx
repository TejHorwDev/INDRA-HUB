import SiteBar from '@/components/SiteBar'
import SiteFoot from '@/components/SiteFoot'
import { INSTALLER_URL } from '@/lib/catalogue'

/*
 * A product that has been taken down is not a dead end.
 *
 * Nothing is published for good, so an old link has to land somewhere that still makes
 * sense: the site says the address is gone, and offers the two things that are not.
 */
export default function NotFound(): React.JSX.Element {
  return (
    <>
      <SiteBar />

      <main>
        <section className="plate">
          <span className="plate-mono" aria-hidden>
            404
          </span>
          <span className="plate-veil" aria-hidden />

          <div className="shell">
            <div className="plate-inner">
              <p className="eyebrow">
                <i style={{ background: 'var(--ink-4)', animation: 'none' }} />
                Nothing at this address
              </p>

              <h1 className="plate-name">This one is gone.</h1>

              <div className="hero-actions">
                <a className="button primary" href="/#products">
                  See what is published
                </a>
                <a className="button ghost" href={INSTALLER_URL}>
                  Download the loader
                </a>
              </div>
            </div>
          </div>
        </section>

        <div className="shell">
          <SiteFoot />
        </div>
      </main>
    </>
  )
}
