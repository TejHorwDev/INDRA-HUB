import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentSession } from '@/lib/auth'
import SignOut from '@/components/SignOut'
import Nav from '@/components/Nav'
import CommandPalette from '@/components/CommandPalette'
import Footer from '@/components/Footer'

import { readConfig } from '@/lib/db'
import { databaseReady } from '@/lib/env'

/*
 * The name on the window, read once per page.
 *
 * It comes from the same config row the site and the loader read, so a rename in Settings
 * changes all three without a deploy. A database that has not been touched yet — a fresh
 * deployment — answers with the default rather than with an empty wordmark.
 */
async function brand(): Promise<{ name: string; mark: string }> {
  if (!databaseReady()) return { name: 'INDRA', mark: 'INDRA' }
  try {
    const config = await readConfig()
    const name = (config.brand_name ?? '').trim() || 'INDRA'
    return { name, mark: (config.brand_mark ?? '').trim() || name }
  } catch {
    return { name: 'INDRA', mark: 'INDRA' }
  }
}

export const dynamic = 'force-dynamic'

/*
 * The panel's frame, and its only lock.
 *
 * Every page under here is server-rendered behind this check, so a page that
 * forgets to guard itself is still guarded. The API routes check again on their
 * own — a layout is not a boundary for anything that is not a page.
 *
 * The bar is solid, not glass: a blurred backdrop over a flat page is a trick that costs
 * a compositor pass every frame to look very slightly different from a solid one. It is
 * sticky, it is a hairline thick, and it holds four words, a search box and a sign-out.
 */
export default async function PanelLayout({
  children
}: {
  children: React.ReactNode
}): Promise<React.JSX.Element> {
  if (!(await currentSession())) redirect('/admin/login')

  const branding = await brand()

  return (
    <main className="shell">
      <header className="bar">
        <div className="bar-inner">
          <Link href="/admin" className="brand" aria-label="admin — overview">
            <span className="brand-mark" aria-hidden="true" />
            <span className="wordmark">
              {branding.mark} <em>/ admin</em>
            </span>
          </Link>

          <div className="bar-actions">
            <Nav />
            <CommandPalette />
            <SignOut />
          </div>
        </div>
      </header>
      {children}
      <Footer />
    </main>
  )
}
