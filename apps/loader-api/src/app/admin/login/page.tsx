import LoginForm from '@/components/LoginForm'
import { readConfig } from '@/lib/db'
import { adminReady, databaseReady } from '@/lib/env'

/** The same brand the panel and the site use, so a customer's login page is theirs. */
async function brand(): Promise<string> {
  if (!databaseReady()) return 'INDRA'
  try {
    const config = await readConfig()
    return (config.brand_name ?? '').trim() || 'INDRA'
  } catch {
    return 'INDRA'
  }
}

export const dynamic = 'force-dynamic'

/*
 * The door.
 *
 * No marketing, no illustration, no logo wall — you are here because you already know
 * what this is. The wordmark at the size of a poster, one line under it, two fields, one
 * button. That is the whole page, and at this size it does not need anything else.
 */
export default async function LoginPage(): Promise<React.JSX.Element> {
  const named = await brand()

  return (
    <main className="center">
      <div className="login">
        <div className="login-mark">
          <span className="brand-mark" aria-hidden="true" />
        </div>
        <h1 className="login-title">{named}</h1>
        <p className="login-sub">Control panel</p>

        {adminReady() ? (
          <LoginForm />
        ) : (
          <div className="notice error">
            The panel is not configured. Set <code>ADMIN_USERNAME</code>, <code>ADMIN_PASSWORD</code> and{' '}
            <code>ADMIN_SESSION_SECRET</code> (32+ characters) in the environment, then reload this page.
          </div>
        )}

        <p className="login-foot">Authorised operators only</p>
      </div>
    </main>
  )
}
