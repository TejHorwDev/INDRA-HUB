import { INSTALLER_URL, getLoader, size } from '@/lib/catalogue'

/*
 * The bar.
 *
 * Four words and one button, at every width. The links are absolute so that the bar on a
 * product page still points at the right place — an in-page anchor on a subpage is a link
 * that goes nowhere, and that is the kind of small wrongness a visitor feels without being
 * able to name it.
 */
export default async function SiteBar(): Promise<React.JSX.Element> {
  const loader = await getLoader()
  const version = loader.version ? `v${loader.version}` : ''
  const weighted = loader.bytes ? size(loader.bytes) : ''

  return (
    <header className="bar">
      <div className="bar-inner">
        <a className="wordmark" href="/" aria-label="INDRA — home">
          INDRA <span>SOFTWARE</span>
        </a>

        <nav className="bar-links" aria-label="Sections">
          <a href="/#products">Products</a>
          <a href="/#how">How it works</a>
          <a href="/#get">
            Download{version ? ` ${version}` : ''}
            {weighted ? <span className="bar-sub"> {weighted}</span> : null}
          </a>
          <a className="button primary keep" href={INSTALLER_URL} style={{ height: 38, padding: '0 18px', fontSize: 13 }}>
            Get the loader
          </a>
        </nav>
      </div>
    </header>
  )
}
