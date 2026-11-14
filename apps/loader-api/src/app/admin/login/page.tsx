import LoginForm from '@/components/LoginForm'
import { adminReady } from '@/lib/env'

export const dynamic = 'force-dynamic'

/*
 * The door.
 *
 * No marketing, no illustration, no logo wall — you are here because you already know
 * what this is. So the page is a matte field, two hairlines crossing it in slow
 * opposition, the mark, and the form.
 */
export default function LoginPage(): React.JSX.Element {
  return (
    <main className="center">
      <div className="login">
        <div className="login-mark">
          <span className="brand-mark" aria-hidden="true" />
        </div>
        <h1 className="login-title">INDRA LOADER</h1>
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
