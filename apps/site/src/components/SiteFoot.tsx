import { getConfig, SITE_URL } from '@/lib/catalogue'

/*
 * The foot.
 *
 * No social links, by instruction — a software site that asks you to follow it on Instagram
 * has told you what it thinks of your time. What is here instead is what somebody might
 * actually want at the bottom of the page: whether the panel is open, and where the build
 * comes from.
 */
export default async function SiteFoot(): Promise<React.JSX.Element> {
  const config = await getConfig()

  /*
   * The panel's website setting now points at this site, so printing it here would be a
   * link to the page you are already on. Say where the build comes from instead.
   */
  const host = SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const published = config.website.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const showWebsite = published.length > 0 && published !== host

  return (
    <footer className="foot">
      <span>INDRA — {new Date().getFullYear()}</span>
      <span>
        <i className="dot" aria-hidden />
        {config.maintenance ? 'Panel in maintenance' : 'Panel online'}
      </span>
      <span>
        {showWebsite ? (
          <a href={config.website} target="_blank" rel="noreferrer">
            {published}
          </a>
        ) : (
          'Built and published in-house'
        )}
      </span>
    </footer>
  )
}
