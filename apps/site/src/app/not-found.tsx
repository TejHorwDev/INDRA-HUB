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
          <span className="plate-veil" aria-hidden />

          <div className="shell">
            <div className="plate-inner">
              <p className="label">404 — nothing at this address</p>

              <h1 className="metal">This one is gone.</h1>

              <div className="actions" style={{ justifyContent: 'flex-start' }}>
                <a className="btn primary" href="/#products">
                  See the lineup
                </a>
                <a className="btn ghost" href={INSTALLER_URL}>
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
