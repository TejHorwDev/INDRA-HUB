import LoginForm from '@/components/LoginForm'
import { adminReady } from '@/lib/env'

export const dynamic = 'force-dynamic'

export default function LoginPage(): React.JSX.Element {
  return (
    <main className="center">
      <div className="login">
        <span className="wordmark">INDRA LOADER · ADMIN</span>
        {adminReady() ? (
          <LoginForm />
        ) : (
          <div className="notice error">
            The panel is not configured. Set <code>ADMIN_USERNAME</code>, <code>ADMIN_PASSWORD</code> and{' '}
            <code>ADMIN_SESSION_SECRET</code> (32+ characters) in the environment, then reload this page.
          </div>
        )}
      </div>
    </main>
  )
}
