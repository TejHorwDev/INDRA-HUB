import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { API_ORIGIN, SITE_URL, getConfig } from '@/lib/catalogue'
import './globals.css'

/*
 * The title is the brand's, not this repository's.
 *
 * A deployment that was sold carries the buyer's name, set in Settings → Brand, and the tab
 * of a browser is part of the shop window. It is read from the panel rather than baked in,
 * so a rename does not need a deploy.
 */
export async function generateMetadata(): Promise<Metadata> {
  const config = await getConfig()
  const name = config.brandName
  const tagline = config.brandTagline || 'software for people who notice the difference'

  return {
    metadataBase: new URL(SITE_URL),
    alternates: { canonical: '/' },
    title: `${name} — ${tagline}`,
    description: `Everything ${name} publishes, in one place. One loader, one sign-in, every product — installed and kept current automatically.`,
    openGraph: {
      title: name,
      description: tagline,
      type: 'website'
    }
  }
}

export const viewport: Viewport = {
  themeColor: '#08090a',
  colorScheme: 'dark'
}

/*
 * The frame.
 *
 * Both fonts are self-hosted from the `geist` package, so the page has the same voice on
 * every machine and renders with no third-party request — a site that waits on a font CDN
 * shows you the wrong typeface first, which is worse than no typeface at all.
 */
export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        {/*
         * The panel is a different origin and the download goes straight at it, so open the
         * connection while the page is still painting. It is one handshake saved on the only
         * click on this site that has to feel instant.
         */}
        <link rel="preconnect" href={API_ORIGIN} crossOrigin="" />
      </head>
      <body>{children}</body>
    </html>
  )
}
