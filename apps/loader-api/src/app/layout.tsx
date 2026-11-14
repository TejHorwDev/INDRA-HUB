import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import Ambience from '@/components/Ambience'
import './globals.css'

export const metadata: Metadata = {
  title: 'INDRA LOADER — panel',
  robots: { index: false, follow: false }
}

export const viewport: Viewport = {
  themeColor: '#08090a',
  colorScheme: 'dark'
}

/*
 * The frame everything hangs in.
 *
 * The two fonts are self-hosted from the `geist` package, so the panel has one voice on
 * every machine instead of whatever Segoe UI happens to be installed — and it renders
 * without a network request, which matters when the whole point of this page is to tell
 * you something is wrong.
 *
 * The ambience is mounted once, above every route, so the light does not restart when
 * you change page.
 */
export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <Ambience />
        {children}
      </body>
    </html>
  )
}
