import Link from 'next/link'
import { redirect } from 'next/navigation'
import { signOut } from '@/app/actions'
import { currentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function Panel({ children }: { children: React.ReactNode }) {
  const user = await currentUser()
  if (!user) redirect('/login')

  const owner = user.role === 'owner'

  return (
    <>
      <header className="bar">
        <div className="wrap bar-in">
          <Link href={owner ? '/' : '/me'} className="mark">
            <b>Ledger</b>
            <span>{owner ? 'clients & payments' : 'my account'}</span>
          </Link>

          <nav>
            {owner ? (
              <>
                <Link href="/">Clients</Link>
                <Link href="/settings">Settings</Link>
              </>
            ) : null}
            <form action={signOut}>
              <button type="submit" className="quiet small">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="page">
        <div className="wrap">{children}</div>
      </main>
    </>
  )
}
