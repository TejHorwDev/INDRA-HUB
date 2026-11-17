import { redirect } from 'next/navigation'
import { changePassword, saveBusiness } from '@/app/admin/actions'
import { requireUser } from '@/lib/ledger/auth'
import { business } from '@/lib/ledger/settings'

export const dynamic = 'force-dynamic'

export default async function Settings({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const user = await requireUser()
  if (user.role !== 'owner') redirect('/me')

  const { e } = await searchParams
  const { name, contact } = await business()

  return (
    <>
      <div className="head">
        <div>
          <h1>Settings</h1>
          <p>What goes on a receipt, and how you sign in.</p>
        </div>
      </div>

      {e ? <p className="error" style={{ marginBottom: 16 }}>{e}</p> : null}

      <div className="grid cols-2">
        <div className="card">
          <header>
            <h2>On the receipt</h2>
          </header>
          <div className="body">
            <form className="stack" action={saveBusiness}>
              <div className="field">
                <label htmlFor="name">Business name</label>
                <input id="name" name="name" defaultValue={name} placeholder="Your name or studio" />
              </div>
              <div className="field">
                <label htmlFor="contact">Contact line</label>
                <input
                  id="contact"
                  name="contact"
                  defaultValue={contact}
                  placeholder="Phone · email · website"
                />
              </div>
              <button type="submit">Save</button>
              <p className="note">These two lines print on every PNG receipt. Nothing else does.</p>
            </form>
          </div>
        </div>

        <div className="card">
          <header>
            <h2>Your password</h2>
          </header>
          <div className="body">
            <form className="stack" action={changePassword}>
              <div className="field">
                <label htmlFor="current">Current password</label>
                <input id="current" name="current" type="password" autoComplete="current-password" required />
              </div>
              <div className="field">
                <label htmlFor="next">New password</label>
                <input id="next" name="next" type="password" autoComplete="new-password" minLength={8} required />
              </div>
              <button type="submit">Change password</button>
              <p className="note">Signed in as {user.username}.</p>
            </form>
          </div>
        </div>
      </div>
    </>
  )
}
