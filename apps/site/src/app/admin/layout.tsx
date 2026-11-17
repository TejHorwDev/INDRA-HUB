import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/ledger/auth'
import '@/app/ledger.css'

export const dynamic = 'force-dynamic'

/*
 * The admin side of the site.
 *
 * Same site, same light — this is a room inside it, not a second application with its own
 * look. The stylesheet below is scoped to `.ledger` so the shopfront's own `.card` and
 * `.brand` keep meaning what they always meant.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser()
  if (!user) redirect('/login')
  if (user.role !== 'owner') redirect('/me')

  return (
    <div className="ledger">
      <div className="ledger-bar">
        <div className="wrap ledger-bar-in">
          <Link href="/admin" className="ledger-mark">
            <b>Ledger</b>
            <span>clients &amp; payments</span>
          </Link>

          <nav className="ledger-nav">
            <Link href="/">Site</Link>
            <Link href="/admin">Clients</Link>
            <Link href="/admin/settings">Settings</Link>
            <form action="/api/session/logout" method="post">
              <button type="submit" className="lbtn quiet small">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </div>

      <main className="ledger-page">
        <div className="wrap">{children}</div>
      </main>
    </div>
  )
}
