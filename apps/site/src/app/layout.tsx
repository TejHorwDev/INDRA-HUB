import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { API_ORIGIN, SITE_URL } from '@/lib/catalogue'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: '/' },
  title: 'INDRA — software for people who notice the difference',
  description:
    'Everything INDRA publishes, in one place. One loader, one sign-in, every product — installed and kept current automatically.',
  openGraph: {
    title: 'INDRA',
    description: 'One loader. Every product. Kept current automatically.',
    type: 'website'
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
