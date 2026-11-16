import Link from 'next/link'
import { downloadTarget, getConfig, getLoader, size } from '@/lib/catalogue'

/*
 * The bar: the app's title bar, straightened out for the web.
 *
 * Wordmark, two links, one white button. No badge, no announcement, nothing that has to be
 * kept in sync with anything.
 */
export default async function SiteBar(): Promise<React.JSX.Element> {
  const [loader, config] = await Promise.all([getLoader(), getConfig()])
  const download = downloadTarget(loader, config)
  const version = loader.version ? `v${loader.version}` : ''
  const weighted = loader.bytes ? size(loader.bytes) : ''

  return (
    <header className="bar">
      <div className="bar-inner">
        <Link className="brand" href="/" aria-label={`${config.brandName} — home`}>
          <i aria-hidden />
          <span className="wordmark">{config.brandMark}</span>
        </Link>

        <nav className="nav" aria-label="Sections">
          <a href="/#library">Library</a>
          <a href="/#how">Loader{version ? ` ${version}` : ''}</a>
          <a className="btn solid keep" {...download.link}>
            Download{weighted ? ` · ${weighted}` : ''}
          </a>
        </nav>
      </div>
    </header>
  )
}
