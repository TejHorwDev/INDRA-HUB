import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import Button from '../components/Button'
import Notice from '../components/Notice'
import PasswordField from '../components/PasswordField'
import TextField from '../components/TextField'
import { errorMessage } from '../lib/api'
import { useSession } from '../lib/session'

export default function LoginScreen() {
  const navigate = useNavigate()
  const { signIn } = useSession()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const identifierRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const identifierError = submitted && !identifier.trim() ? 'Username or email is required.' : null
  const passwordError = submitted && !password ? 'Password is required.' : null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    setFormError(null)

    if (!identifier.trim()) {
      identifierRef.current?.focus()
      return
    }
    if (!password) {
      passwordRef.current?.focus()
      return
    }

    setPending(true)
    try {
      await signIn({ identifier: identifier.trim(), password })
      navigate('/dashboard', { replace: true })
    } catch (error) {
      setFormError(errorMessage(error))
      setPending(false)
    }
  }

  return (
    <AuthLayout>
      <h1 className="auth-title">Sign in</h1>

      <div className="auth-rule" />

      <form onSubmit={handleSubmit} noValidate>
        <div className="space-y-4">
          <TextField
            ref={identifierRef}
            label="Username or email"
            name="identifier"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            error={identifierError}
            placeholder="you or you@company.com"
            autoComplete="username"
            spellCheck={false}
            autoFocus
            disabled={pending}
          />

          <PasswordField
            ref={passwordRef}
            label="Password"
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={passwordError}
            placeholder="Enter your password"
            autoComplete="current-password"
            disabled={pending}
          />
        </div>

        <div className="mt-6 space-y-3">
          <Button type="submit" loading={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
          {formError && <Notice>{formError}</Notice>}
        </div>
      </form>

      <p className="auth-alt">
        No account yet?{' '}
        <Link to="/register" className="link">
          Create one
        </Link>
      </p>

      {/* Nothing here points at the administration area. The installation ships
          with its administrator already created; the panel is reached with
          Ctrl+Alt+A (Cmd+Alt+A on macOS) by someone who knows it exists. */}
    </AuthLayout>
  )
}
