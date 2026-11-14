import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentSession } from '@/lib/auth'
import SignOut from '@/components/SignOut'
import Nav from '@/components/Nav'

export const dynamic = 'force-dynamic'

/*
 * The panel's frame, and its only lock.
 *
 * Every page under here is server-rendered behind this check, so a page that
 * forgets to guard itself is still guarded. The API routes check again on their
 * own — a layout is not a boundary for anything that is not a page.
 *
 * The bar is glass: sticky, blurred, a hairline along its bottom edge. It is the one
 * thing on the page that never leaves, so it is also the one thing that can be quiet.
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
            <span className="bar-user">signed in</span>
            <SignOut />
          </div>
        </div>
      </header>
      {children}
    </main>
  )
}
