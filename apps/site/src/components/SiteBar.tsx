import { INSTALLER_URL, getLoader, size } from '@/lib/catalogue'

/*
 * The bar.
 *
 * Sticky, and it always carries the one action the page exists for. The links are absolute
 * so that the bar on a product page still points at the right place.
 */
export default async function SiteBar(): Promise<React.JSX.Element> {
  const loader = await getLoader()
  const version = loader.version ? `v${loader.version}` : ''
  const weighted = loader.bytes ? size(loader.bytes) : ''

  return (
    <header className="bar">
      <div className="bar-inner">
        <a className="wordmark" href="/" aria-label="INDRA — home">
          <i aria-hidden />
          INDRA
        </a>

        <nav className="nav" aria-label="Sections">
          <a href="/#products">Products</a>
          <a href="/#how">How it works</a>
          <a href="/#get">
            Download{version ? ` ${version}` : ''}
            {weighted ? ` · ${weighted}` : ''}
          </a>
          <a className="btn primary sm keep" href={INSTALLER_URL}>
            Get the loader
          </a>
        </nav>
      </div>
    </header>
  )
}
