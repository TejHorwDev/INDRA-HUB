import SiteBar from '@/components/SiteBar'
import SiteFoot from '@/components/SiteFoot'
import { INSTALLER_URL } from '@/lib/catalogue'

/*
 * A product that has been taken down is not a dead end.
 */
export default function NotFound(): React.JSX.Element {
  return (
    <>
      <SiteBar />

      <main>
        <div className="wrap">
          <div className="detail">
            <div>
              <p className="label">404</p>
              <h1 className="wordmark" style={{ marginTop: 12 }}>
                Not here.
              </h1>
              <p className="tagline">This address is gone. The library is not.</p>

              <div className="detail-actions">
                <a className="btn solid lg" href="/#library">
                  The library
                </a>
                <a className="btn ghost lg" href={INSTALLER_URL}>
                  Download the loader
                </a>
              </div>
            </div>
          </div>

          <SiteFoot />
        </div>
      </main>
    </>
  )
}
