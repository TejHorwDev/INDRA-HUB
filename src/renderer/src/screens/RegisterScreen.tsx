import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import Button from '../components/Button'
import Notice from '../components/Notice'
import PasswordField from '../components/PasswordField'
import PasswordStrength from '../components/PasswordStrength'
import TextField from '../components/TextField'
import { ApiError, errorMessage } from '../lib/api'
import { useAppStatus } from '../lib/appStatus'
import { useSession } from '../lib/session'
import { passwordStrength, validateEmail, validateName } from '../lib/validation'

type FieldName =
  | 'username'
  | 'displayName'
  | 'email'
  | 'activationKey'
  | 'password'
  | 'confirmPassword'

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,23}$/

export default function RegisterScreen() {
  const navigate = useNavigate()
  const { signUp } = useSession()
  const { status } = useAppStatus()

  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [activationKey, setActivationKey] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [serverIssue, setServerIssue] = useState<{ field?: string; message: string } | null>(null)

  const usernameRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  const strength = passwordStrength(password)

  const clientIssues: Partial<Record<FieldName, string | null>> = {
    username: !username.trim()
      ? submitted
        ? 'Username is required.'
        : null
      : !USERNAME_PATTERN.test(username.trim().toLowerCase())
        ? '3–24 characters: letters, numbers, hyphen or underscore.'
        : null,
    displayName: displayName.trim() || submitted ? validateName(displayName) : null,
    email: !email.trim()
      ? submitted
        ? 'Email is required.'
        : null
      : email.includes('@') || submitted
        ? validateEmail(email)
        : null,
    activationKey:
      status.requireActivationKey && !activationKey.trim() ? 'Activation key is required.' : null,
    password: !password
      ? submitted
        ? 'Password is required.'
        : null
      : submitted && strength.score < 3
        ? 'Choose a stronger password.'
        : null,
    confirmPassword: !confirmPassword
      ? submitted
        ? 'Confirm your password.'
        : null
      : password !== confirmPassword
        ? "Passwords don't match."
        : null
  }

  function fieldError(field: FieldName): string | null {
    if (clientIssues[field]) return clientIssues[field] ?? null
    if (serverIssue?.field === field) return serverIssue.message
    return null
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    setServerIssue(null)

    const focusOrder: Array<[FieldName, HTMLInputElement | null]> = [
      ['username', usernameRef.current],
      ['displayName', nameRef.current],
      ['email', emailRef.current],
      ...(status.requireActivationKey ? ([['activationKey', keyRef.current]] as Array<[FieldName, HTMLInputElement | null]>) : []),
      ['password', passwordRef.current],
      ['confirmPassword', confirmRef.current]
    ]

    const firstInvalid = focusOrder.find(([field]) => clientIssues[field])
    if (firstInvalid) {
      firstInvalid[1]?.focus()
      return
    }

    setPending(true)
    try {
      await signUp({
        username: username.trim().toLowerCase(),
        displayName: displayName.trim(),
        email: email.trim(),
        password,
        activationKey: activationKey.trim() || undefined
      })
      navigate('/dashboard', { replace: true })
    } catch (error) {
      setServerIssue({
        field: error instanceof ApiError ? error.field : undefined,
        message: errorMessage(error)
      })
      setPending(false)
    }
  }

  if (!status.allowRegistration) {
    return (
      <AuthLayout>
        <h1 className="auth-title">Registration closed</h1>
        <div className="auth-rule" />
        <p className="maintenance-copy">
          New account creation is turned off by the administrator right now. Existing accounts can
          still sign in.
        </p>
        <p className="auth-alt">
          Already have an account?{' '}
          <Link to="/login" className="link">
            Sign in
          </Link>
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <h1 className="auth-title">Create account</h1>

      <div className="auth-rule" />

      <form onSubmit={handleSubmit} noValidate>
        <div className="space-y-4">
          <TextField
            ref={usernameRef}
            label="Username"
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            error={fieldError('username')}
            placeholder="your-handle"
            autoComplete="username"
            spellCheck={false}
            autoCapitalize="none"
            autoFocus
            disabled={pending}
          />

          <TextField
            ref={nameRef}
            label="Display name"
            name="displayName"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            error={fieldError('displayName')}
            placeholder="Your name"
            autoComplete="name"
            disabled={pending}
          />

          <TextField
            ref={emailRef}
            label="Email"
            type="email"
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={fieldError('email')}
            placeholder="you@company.com"
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
            disabled={pending}
          />

          {status.requireActivationKey && (
            <TextField
              ref={keyRef}
              label="Activation key"
              name="activationKey"
              value={activationKey}
              onChange={(event) => setActivationKey(event.target.value)}
              error={fieldError('activationKey')}
              placeholder="INDRA-XXXX-XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
              hint={
                <p className="field-hint">Ask the administrator for an unused key.</p>
              }
            />
          )}

          <PasswordField
            ref={passwordRef}
            label="Password"
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldError('password')}
            placeholder="Create a password"
            autoComplete="new-password"
            disabled={pending}
            hint={password ? <PasswordStrength password={password} /> : undefined}
          />

          <PasswordField
            ref={confirmRef}
            label="Confirm password"
            name="confirmPassword"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            error={fieldError('confirmPassword')}
            placeholder="Re-enter your password"
            autoComplete="new-password"
            disabled={pending}
          />
        </div>

        <div className="mt-6 space-y-3">
          <Button type="submit" loading={pending}>
            {pending ? 'Creating account…' : 'Create account'}
          </Button>
          {serverIssue && !serverIssue.field && <Notice>{serverIssue.message}</Notice>}
        </div>
      </form>

      <p className="auth-alt">
        Already have an account?{' '}
        <Link to="/login" className="link">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
