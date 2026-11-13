import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import Button from '../components/Button'
import Notice from '../components/Notice'
import PasswordField from '../components/PasswordField'
import PasswordStrength from '../components/PasswordStrength'
import PortraitPicker from '../components/PortraitPicker'
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
type FieldName = 'email' | 'password' | 'confirmPassword' | 'activationKey' | 'username' | 'displayName'

interface PickedPhoto {
  bytes: Uint8Array
  name: string
  /** A local preview only; the bytes travel with the registration. */
  url: string
}

/**
 * Registration, in three steps on one page.
 *
 * The account is created at the END of step three, after the portrait — not
 * before it. Asking for a face and then handing out an account would make the
 * portrait an optional afterthought; doing it in this order means the person
 * exists with the face they chose, and a failure at any point leaves nothing
 * half-made.
 *
 * A portrait can be a real photograph. The bytes are read here, checked for
 * type and size before they leave the renderer, and validated again in the main
 * process by their signature before anything is written to disk.
 */
export default function RegisterScreen() {
  const { signUp } = useSession()
  const { status } = useAppStatus()

  const [step, setStep] = useState<Step>(1)
  const [attempted, setAttempted] = useState<Set<Step>>(new Set())

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [activationKey, setActivationKey] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')

  const [photo, setPhoto] = useState<PickedPhoto | null>(null)
  const [picking, setPicking] = useState(false)

  const [pending, setPending] = useState(false)
  const [portraitError, setPortraitError] = useState<string | null>(null)
  const [serverIssue, setServerIssue] = useState<{ field?: string; message: string } | null>(null)

  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  const usernameRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const strength = passwordStrength(password)

  const credentialIssues: Partial<Record<FieldName, string>> = {
    email: !email.trim()
      ? 'Email is required.'
      : email.includes('@')
        ? (validateEmail(email) ?? undefined)
        : 'Enter a complete email address.',
    password: !password ? 'Password is required.' : strength.score < 3 ? 'Choose a stronger password.' : undefined,
    confirmPassword: !confirmPassword
      ? 'Confirm your password.'
      : password !== confirmPassword
        ? "Passwords don't match."
        : undefined,
    activationKey:
      status.requireActivationKey && !activationKey.trim() ? 'Activation key is required.' : undefined
  }

  const identityIssues: Partial<Record<FieldName, string>> = {
    username: !username.trim()
      ? 'Username is required.'
      : !USERNAME_PATTERN.test(username.trim().toLowerCase())
        ? '3–24 characters: letters, numbers, hyphen or underscore.'
        : undefined,
    displayName: displayName.trim() ? (validateName(displayName) ?? undefined) : 'Display name is required.'
  }

  const allIssues = { ...credentialIssues, ...identityIssues }

  function shown(field: FieldName): string | null {
    if (serverIssue?.field === field) return serverIssue.message
    if (!attempted.has(step)) return null
    return allIssues[field] ?? null
  }

  function credentialsNext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAttempted((before) => new Set(before).add(1))
    setServerIssue(null)

    const order: Array<[FieldName, HTMLInputElement | null]> = [
      ['email', emailRef.current],
      ['password', passwordRef.current],
      ['confirmPassword', confirmRef.current],
      ...(status.requireActivationKey
        ? ([['activationKey', keyRef.current]] as Array<[FieldName, HTMLInputElement | null]>)
        : [])
    ]

    const first = order.find(([field]) => credentialIssues[field])
    if (first) {
      first[1]?.focus()
      return
    }

    setStep(2)
  }

  function identityNext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAttempted((before) => new Set(before).add(2))
    setServerIssue(null)

    if (identityIssues.username) {
      usernameRef.current?.focus()
      return
    }
    if (identityIssues.displayName) {
      nameRef.current?.focus()
      return
    }

    setStep(3)
  }

  /**
   * The system's picture picker, not a hidden file input.
   *
   * The main process opens the dialog and hands back only the bytes of the
   * image that was chosen, after checking its size and signature. This screen
   * draws a local preview from those bytes; the same bytes are what the
   * registration carries, so there is no second read of the file.
   */
  async function pickPhoto(): Promise<void> {
    setPortraitError(null)
    setPicking(true)
    try {
      const picked = await api.auth.choosePortrait()
      if (!picked) return

      const copy = new Uint8Array(picked.bytes.length)
      copy.set(picked.bytes)
      const url = URL.createObjectURL(new Blob([copy.buffer as ArrayBuffer], { type: picked.mime }))

      setPhoto((previous) => {
        if (previous) URL.revokeObjectURL(previous.url)
        return { bytes: picked.bytes, name: picked.name, url }
      })
    } catch (error) {
      setPortraitError(errorMessage(error))
    } finally {
      setPicking(false)
    }
  }

  function clearPhoto(): void {
    setPhoto((previous) => {
      if (previous) URL.revokeObjectURL(previous.url)
      return null
    })
  }

  async function createAccount(): Promise<void> {
    setServerIssue(null)
    setPending(true)
    try {
      await signUp({
        username: username.trim().toLowerCase(),
        displayName: displayName.trim(),
        email: email.trim(),
        password,
        activationKey: activationKey.trim() || undefined,
        // The picture travels as bytes; without one the account keeps initials.
        avatar: photo ? undefined : 'initials',
        avatarPhoto: photo ? { bytes: photo.bytes, name: photo.name } : undefined
      })
      // The session provider records the arrival; the app owns the four
      // seconds after this and then opens the workspace.
    } catch (error) {
      const field = error instanceof ApiError ? error.field : undefined
      setServerIssue({ field, message: errorMessage(error) })
      if (field === 'email' || field === 'password' || field === 'activationKey') {
        setAttempted((before) => new Set(before).add(1))
        setStep(1)
      } else if (field === 'username' || field === 'displayName') {
        setAttempted((before) => new Set(before).add(2))
        setStep(2)
      } else if (field === 'avatar') {
        setPortraitError(errorMessage(error))
      }
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

  const headings: Record<Step, { title: string; sub: string }> = {
    1: { title: 'Create account', sub: 'The details you sign in with — nothing else yet.' },
    2: { title: 'Who you are', sub: 'Your handle, and the name the people you work with will see.' },
    3: { title: 'Your portrait', sub: 'A picture of you. You can change it whenever you like.' }
  }

  const previewName = displayName.trim() || 'Your name'

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
          <form onSubmit={identityNext} noValidate>
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
              />
            </div>

            <div className="auth-actions auth-actions--split">
              <button type="button" className="btn btn-ghost w-auto" onClick={() => setStep(1)}>
                Back
              </button>
              <Button type="submit">Continue</Button>
            </div>
          </form>
        )}

        {step === 3 && (
          <div>
            <PortraitPicker
              name={previewName}
              avatar="initials"
              photoUrl={photo?.url ?? null}
              busy={picking}
              onChoose={() => void pickPhoto()}
              onRemove={photo ? clearPhoto : undefined}
            />

            {portraitError && (
              <div className="auth-actions auth-actions--stack">
                <Notice>{portraitError}</Notice>
              </div>
            )}

            {serverIssue && !serverIssue.field && (
              <div className="auth-actions auth-actions--stack">
                <Notice>{serverIssue.message}</Notice>
              </div>
            )}

            <div className="auth-actions auth-actions--split">
              <button
                type="button"
                className="btn btn-ghost w-auto"
                onClick={() => setStep(2)}
                disabled={pending}
              >
                Back
              </button>
              <Button type="button" loading={pending} onClick={() => void createAccount()}>
                {pending ? 'Creating account…' : 'Create account'}
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
        <p className="auth-foot-note">Your name and handle can be changed later in Settings.</p>
      )}

      {step === 3 && (
        <p className="auth-foot-note">
          Your picture is copied into the app on this PC. Nothing is uploaded.
        </p>
      )}
    </AuthLayout>
  )
}
