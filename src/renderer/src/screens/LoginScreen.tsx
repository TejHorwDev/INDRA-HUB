import { useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import Button from '../components/Button'
import Notice from '../components/Notice'
import PasswordField from '../components/PasswordField'
import TextField from '../components/TextField'
import { api, errorMessage } from '../lib/api'
import { useSession } from '../lib/session'

export default function LoginScreen() {
  const navigate = useNavigate()
  const { signIn, refresh } = useSession()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // A wrong password is almost always a typing problem. Caps Lock is the one
  // the app can see, so it says so instead of letting the sign-in fail.
  const [capsLock, setCapsLock] = useState(false)

  const identifierRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const watchCapsLock = (event: KeyboardEvent<HTMLInputElement>): void => {
    setCapsLock(event.getModifierState?.('CapsLock') ?? false)
  }

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
      navigate('/home', { replace: true })
    } catch (error) {
      /*
       * One screen, two identities. If these are the administrator's
       * credentials, the panel opens instead of an error appearing; everyone
       * else gets the ordinary message, and a wrong password on any other
       * address cannot touch the administrator's throttle.
       */
      const admin = await api.auth
        .signInAdmin({ identifier: identifier.trim(), password })
        .catch(() => null)

      if (admin) {
        navigate('/admin', { replace: true })
        return
      }

      setFormError(errorMessage(error))
      setPending(false)
    }
  }

  return (
    <AuthLayout>
      <h1 className="auth-title">Authentication</h1>

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
            placeholder="you@gmail.com"
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
            hint={capsLock ? 'Caps Lock is on.' : undefined}
            onKeyDown={watchCapsLock}
            onKeyUp={watchCapsLock}
            onBlur={() => setCapsLock(false)}
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

      {/*
        Working offline is a choice as well as a circumstance: someone can open
        the writing tools on a connected PC without an account. It is the same
        workspace the offline screen offers, opened the same way.
      */}
      <p className="auth-alt auth-alt--offline">
        Or{' '}
        <button
          type="button"
          className="link link-button"
          onClick={() => {
            void (async () => {
              try {
                await api.offline.start()
                await refresh()
                navigate('/documents', { replace: true })
              } catch (failure) {
                setFormError(errorMessage(failure))
              }
            })()
          }}
        >
          work offline
        </button>{' '}
        — the writing tools, saved on this PC, no account needed.
      </p>

      {/* Nothing here points at the administration area. The installation ships
          with its administrator already created; the panel is reached with
          Ctrl+Alt+A (Cmd+Alt+A on macOS) by someone who knows it exists. */}
    </AuthLayout>
  )
}
