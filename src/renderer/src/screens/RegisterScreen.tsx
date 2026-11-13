import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { SessionUser } from '@shared/types'
import AuthLayout from '../components/AuthLayout'
import Avatar, { AVATAR_MARKS } from '../components/Avatar'
import Button from '../components/Button'
import Notice from '../components/Notice'
import PasswordField from '../components/PasswordField'
import PasswordStrength from '../components/PasswordStrength'
import TextField from '../components/TextField'
import { ApiError, api, errorMessage } from '../lib/api'
import { useAppStatus } from '../lib/appStatus'
import { useSession } from '../lib/session'
import { passwordStrength, validateEmail, validateName } from '../lib/validation'

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,23}$/

const STEPS = [
  { n: 1, label: 'Credentials' },
  { n: 2, label: 'Identity' },
  { n: 3, label: 'Portrait' }
] as const

type Step = 1 | 2 | 3

/**
 * Registration, in three steps on one page.
 *
 * A single form with six fields asks for decisions in the order they matter:
 * a handle and a picture are not credentials, and a wall of inputs makes every
 * one of them feel optional. So the page opens with only what is needed to
 * make the account — email, password, confirmation — then asks who the person
 * is, then, once the account exists, shows them eight marks and lets them pick
 * one or keep their initials.
 *
 * The account is created at the end of step two, so the portrait step is a
 * signed-in edit rather than a required field: closing the app on step three
 * leaves a working account with initials, never a half-registered one.
 */
export default function RegisterScreen() {
  const navigate = useNavigate()
  const { signUp, refresh } = useSession()
  const { status } = useAppStatus()

  const [step, setStep] = useState<Step>(1)
  const [attempted, setAttempted] = useState<Set<Step>>(new Set())

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [activationKey, setActivationKey] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')

  /** The account exists by the time step three renders. */
  const [created, setCreated] = useState<SessionUser | null>(null)
  const [avatar, setAvatar] = useState<string | null>(null)

  const [pending, setPending] = useState(false)
  const [savingPortrait, setSavingPortrait] = useState(false)
  const [portraitError, setPortraitError] = useState<string | null>(null)
  const [serverIssue, setServerIssue] = useState<{ field?: string; message: string } | null>(null)

  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  const usernameRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const strength = passwordStrength(password)

  const credentialIssues: Partial<Record<'email' | 'password' | 'confirmPassword' | 'activationKey', string>> =
    {
      email: !email.trim()
        ? 'Email is required.'
        : email.includes('@')
          ? (validateEmail(email) ?? undefined)
          : 'Enter a complete email address.',
      password: !password
        ? 'Password is required.'
        : strength.score < 3
          ? 'Choose a stronger password.'
          : undefined,
      confirmPassword: !confirmPassword
        ? 'Confirm your password.'
        : password !== confirmPassword
          ? "Passwords don't match."
          : undefined,
      activationKey:
        status.requireActivationKey && !activationKey.trim() ? 'Activation key is required.' : undefined
    }

  const identityIssues: Partial<Record<'username' | 'displayName', string>> = {
    username: !username.trim()
      ? 'Username is required.'
      : !USERNAME_PATTERN.test(username.trim().toLowerCase())
        ? '3–24 characters: letters, numbers, hyphen or underscore.'
        : undefined,
    displayName: displayName.trim() ? (validateName(displayName) ?? undefined) : 'Display name is required.'
  }

  function shown(field: 'email' | 'password' | 'confirmPassword' | 'activationKey' | 'username' | 'displayName'): string | null {
    if (serverIssue?.field === field) return serverIssue.message
    if (!attempted.has(step)) return null
    return (
      (credentialIssues as Record<string, string | undefined>)[field] ??
      (identityIssues as Record<string, string | undefined>)[field] ??
      null
    )
  }

  function credentialsNext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAttempted((before) => new Set(before).add(1))
    setServerIssue(null)

    const order: Array<['email' | 'password' | 'confirmPassword' | 'activationKey', HTMLInputElement | null]> = [
      ['email', emailRef.current],
      ['password', passwordRef.current],
      ['confirmPassword', confirmRef.current],
      ...(status.requireActivationKey ? ([['activationKey', keyRef.current]] as Array<['activationKey', HTMLInputElement | null]>) : [])
    ]

    const first = order.find(([field]) => credentialIssues[field])
    if (first) {
      first[1]?.focus()
      return
    }

    setStep(2)
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAttempted((before) => new Set(before).add(2))
    setServerIssue(null)

    if (identityIssues.username || identityIssues.displayName) {
      if (identityIssues.username) usernameRef.current?.focus()
      else nameRef.current?.focus()
      return
    }

    setPending(true)
    try {
      const account = await signUp({
        username: username.trim().toLowerCase(),
        displayName: displayName.trim(),
        email: email.trim(),
        password,
        activationKey: activationKey.trim() || undefined
      })
      setCreated(account)
      setStep(3)
    } catch (error) {
      const field = error instanceof ApiError ? error.field : undefined
      setServerIssue({ field, message: errorMessage(error) })
      // A field the server rejected belongs to an earlier step: go back to it
      // rather than showing an error under a form that cannot fix it.
      if (field === 'email' || field === 'password' || field === 'activationKey') setStep(1)
    } finally {
      setPending(false)
    }
  }

  async function finish(withPortrait: boolean): Promise<void> {
    if (!created) return
    setPortraitError(null)

    if (withPortrait && avatar) {
      setSavingPortrait(true)
      try {
        await api.auth.updateProfile({
          displayName: created.displayName,
          email: created.email,
          avatar
        })
        await refresh()
      } catch (error) {
        setPortraitError(errorMessage(error))
        setSavingPortrait(false)
        return
      }
      setSavingPortrait(false)
    }

    navigate('/home', { replace: true })
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

  const headings: Record<Step, { title: string; sub: string }> = {
    1: { title: 'Create account', sub: 'The details you sign in with — nothing else yet.' },
    2: { title: 'Who you are', sub: 'Your handle, and the name the people you work with will see.' },
    3: { title: 'Your portrait', sub: 'Chosen once. It appears wherever you do.' }
  }

  return (
    <AuthLayout>
      <ol className="auth-steps" aria-label={`Step ${step} of 3`}>
        {STEPS.map((entry) => (
          <li
            key={entry.n}
            className={`auth-step${step === entry.n ? ' is-current' : ''}${step > entry.n ? ' is-done' : ''}`}
            aria-current={step === entry.n ? 'step' : undefined}
          >
            <span className="auth-step-bar" aria-hidden="true" />
            <span className="auth-step-label">
              <span className="auth-step-num">{String(entry.n).padStart(2, '0')}</span>
              {entry.label}
            </span>
          </li>
        ))}
      </ol>

      <h1 className="auth-title">{headings[step].title}</h1>
      <p className="auth-sub">{headings[step].sub}</p>

      <div className="auth-rule" />

      <div className="auth-step-body" key={step}>
        {step === 1 && (
          <form onSubmit={credentialsNext} noValidate>
            <div className="space-y-4">
              <TextField
                ref={emailRef}
                label="Email"
                type="email"
                name="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                error={shown('email')}
                placeholder="you@gmail.com"
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                autoFocus
              />

              <PasswordField
                ref={passwordRef}
                label="Password"
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                error={shown('password')}
                placeholder="Create a password"
                autoComplete="new-password"
                hint={password ? <PasswordStrength password={password} /> : undefined}
              />

              <PasswordField
                ref={confirmRef}
                label="Confirm password"
                name="confirmPassword"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                error={shown('confirmPassword')}
                placeholder="Re-enter your password"
                autoComplete="new-password"
              />

              {status.requireActivationKey && (
                <TextField
                  ref={keyRef}
                  label="Activation key"
                  name="activationKey"
                  value={activationKey}
                  onChange={(event) => setActivationKey(event.target.value)}
                  error={shown('activationKey')}
                  placeholder="INDRA-XXXX-XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  hint={<p className="field-hint">Ask the administrator for an unused key.</p>}
                />
              )}
            </div>

            <div className="auth-actions">
              <Button type="submit">Continue</Button>
            </div>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={createAccount} noValidate>
            <div className="space-y-4">
              <TextField
                ref={usernameRef}
                label="Username"
                name="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                error={shown('username')}
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
                error={shown('displayName')}
                placeholder="Your name"
                autoComplete="name"
                disabled={pending}
              />
            </div>

            {serverIssue && !serverIssue.field && (
              <div className="auth-actions auth-actions--stack">
                <Notice>{serverIssue.message}</Notice>
              </div>
            )}

            <div className="auth-actions auth-actions--split">
              <button type="button" className="btn btn-ghost w-auto" onClick={() => setStep(1)} disabled={pending}>
                Back
              </button>
              <Button type="submit" loading={pending}>
                {pending ? 'Creating account…' : 'Create account'}
              </Button>
            </div>
          </form>
        )}

        {step === 3 && created && (
          <div>
            <div className="portrait-stage">
              <Avatar
                name={created.displayName}
                avatar={avatar}
                size="xl"
                className="portrait-preview"
                title={`${created.displayName}'s portrait`}
              />
              <div className="portrait-stage-text">
                <p className="portrait-name">{created.displayName}</p>
                <p className="portrait-handle">@{created.username}</p>
                <p className="portrait-note">This is how the team sees you.</p>
              </div>
            </div>

            <div className="portrait-grid" role="radiogroup" aria-label="Choose a portrait">
              {AVATAR_MARKS.map((mark) => {
                const value = `mark:${mark.id}`
                const selected = avatar === value
                return (
                  <button
                    key={mark.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={mark.label}
                    title={mark.label}
                    className={`portrait-choice${selected ? ' is-selected' : ''}`}
                    onClick={() => setAvatar(value)}
                  >
                    <Avatar name={created.displayName} avatar={value} size="lg" />
                  </button>
                )
              })}

              <button
                type="button"
                role="radio"
                aria-checked={avatar === 'initials'}
                aria-label="My initials"
                title="My initials"
                className={`portrait-choice portrait-choice--initials${avatar === 'initials' ? ' is-selected' : ''}`}
                onClick={() => setAvatar('initials')}
              >
                <Avatar name={created.displayName} avatar="initials" size="lg" />
              </button>
            </div>

            <p className="auth-hint">
              Each mark is drawn in the app, not uploaded — it stays sharp at any size and costs
              nothing to share.
            </p>

            {portraitError && (
              <div className="auth-actions auth-actions--stack">
                <Notice>{portraitError}</Notice>
              </div>
            )}

            <div className="auth-actions auth-actions--split">
              <button
                type="button"
                className="btn btn-ghost w-auto"
                onClick={() => void finish(false)}
                disabled={savingPortrait}
              >
                Skip
              </button>
              <Button type="button" loading={savingPortrait} onClick={() => void finish(true)}>
                {savingPortrait ? 'Saving…' : 'Continue'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {step === 1 && (
        <p className="auth-alt">
          Already have an account?{' '}
          <Link to="/login" className="link">
            Sign in
          </Link>
        </p>
      )}

      {step === 2 && (
        <p className="auth-foot-note">
          You can change your handle, name and portrait later in Settings.
        </p>
      )}

      {step === 3 && (
        <p className="auth-foot-note">
          Nothing is uploaded. Skipping keeps your initials.
        </p>
      )}
    </AuthLayout>
  )
}
