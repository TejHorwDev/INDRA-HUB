import { redirect } from 'next/navigation'
import { createOwner, signIn } from '@/app/actions'
import { currentUser, needsOwner } from '@/lib/auth'
import { configured, MISSING } from '@/lib/env'

export const dynamic = 'force-dynamic'

export default async function Login({
  searchParams
}: {
  searchParams: Promise<{ e?: string }>
}) {
  const { e } = await searchParams

  if (!configured) {
    return (
      <div className="login">
        <div className="card">
          <div className="body">
            <span className="brand">Ledger</span>
            <h1>Not connected yet</h1>
            <p className="note">{MISSING}</p>
          </div>
        </div>
      </div>
    )
  }

  /*
   * A database that refuses the very first query has to say so out loud. Otherwise the screen
   * looks healthy, the form looks fine, and the button appears to do nothing — which is what a
   * wrong key looks like from the outside.
   */
  let dbError: string | null = null
  let first = false

  try {
    const user = await currentUser()
    if (user) redirect(user.role === 'owner' ? '/' : '/me')
    first = await needsOwner()
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) throw error
    dbError = error instanceof Error ? error.message : String(error)
  }

  if (dbError) {
    return (
      <div className="login">
        <div className="card">
          <div className="body">
            <span className="brand">Ledger</span>
            <h1>The database refused the connection</h1>
            <p className="error">{dbError.slice(0, 400)}</p>
            <p className="note">
              Usually the service key. It must be the <strong>service_role</strong> key from
              Supabase → Settings → API Keys — not the anon / publishable one, which is what a
              project hands you first.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="login">
      <div className="card">
        <div className="body">
          <span className="brand">Ledger</span>

          {first ? (
            <>
              <h1>Set up the ledger</h1>
              <p className="note">
                One account, yours. Clients get their own logins from inside, later — and they only ever
                see what you gave them.
              </p>
              <form className="stack" action={createOwner}>
                <div className="field">
                  <label htmlFor="business">Your business name</label>
                  <input id="business" name="business" placeholder="What goes on the receipt" />
                </div>
                <div className="field">
                  <label htmlFor="username">Username</label>
                  <input id="username" name="username" autoComplete="username" required />
                </div>
                <div className="field">
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </div>
                {e ? <p className="error">{e}</p> : null}
                <button type="submit">Create the ledger</button>
              </form>
            </>
          ) : (
            <>
              <h1>Sign in</h1>
              <form className="stack" action={signIn}>
                <div className="field">
                  <label htmlFor="username">Username</label>
                  <input id="username" name="username" autoComplete="username" required />
                </div>
                <div className="field">
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </div>
                {e ? <p className="error">{e}</p> : null}
                <button type="submit">Sign in</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
