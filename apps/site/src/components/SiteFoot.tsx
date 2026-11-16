import { getConfig } from '@/lib/catalogue'

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

  return (
    <footer className="foot">
      <span>INDRA — {new Date().getFullYear()}</span>
      <span>
        <i className="dot" aria-hidden />
        {config.maintenance ? 'Panel in maintenance' : 'Panel online'}
      </span>
      <span>
        {config.website ? (
          <a href={config.website} target="_blank" rel="noreferrer">
            {config.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
          </a>
        ) : (
          'Built and published in-house'
        )}
      </span>
    </footer>
  )
}
