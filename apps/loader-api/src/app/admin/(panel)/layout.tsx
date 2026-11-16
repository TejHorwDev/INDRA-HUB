import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentSession } from '@/lib/auth'
import SignOut from '@/components/SignOut'
import Nav from '@/components/Nav'
import CommandPalette from '@/components/CommandPalette'
import Footer from '@/components/Footer'

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

  return (
    <main className="shell">
      <header className="bar">
        <div className="bar-inner">
          <Link href="/admin" className="brand" aria-label="INDRA LOADER admin — overview">
            <span className="brand-mark" aria-hidden="true" />
            <span className="wordmark">
              INDRA LOADER <em>/ admin</em>
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
