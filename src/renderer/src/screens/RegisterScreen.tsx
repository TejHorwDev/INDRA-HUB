import { useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import Avatar, { AVATAR_MARKS } from '../components/Avatar'
import Button from '../components/Button'
import Notice from '../components/Notice'
import PasswordField from '../components/PasswordField'
import PasswordStrength from '../components/PasswordStrength'
import TextField from '../components/TextField'
import { ApiError, errorMessage } from '../lib/api'
import { useAppStatus } from '../lib/appStatus'
import { useSession } from '../lib/session'
import { passwordStrength, validateEmail, validateName } from '../lib/validation'

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,23}$/
const MAX_PHOTO_BYTES = 6 * 1024 * 1024
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp']

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

  /** A drawn mark (`mark:<id>`) or `initials`. A photo wins while it is set. */
  const [avatar, setAvatar] = useState<string>('initials')
  const [photo, setPhoto] = useState<PickedPhoto | null>(null)

  const [pending, setPending] = useState(false)
  const [portraitError, setPortraitError] = useState<string | null>(null)
  const [serverIssue, setServerIssue] = useState<{ field?: string; message: string } | null>(null)

  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  const usernameRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)

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

  async function pickPhoto(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    // The same input can be used again for a replacement.
    event.target.value = ''
    if (!file) return

    setPortraitError(null)

    if (!PHOTO_TYPES.includes(file.type)) {
      setPortraitError('Choose a PNG, JPEG or WebP image.')
      return
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPortraitError('That photo is larger than 6 MB. Pick a smaller one.')
      return
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      setPhoto((previous) => {
        if (previous) URL.revokeObjectURL(previous.url)
        return { bytes, name: file.name, url: URL.createObjectURL(file) }
      })
    } catch {
      setPortraitError('That file could not be read.')
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
        // A photo is sent as bytes; without one, the drawn choice is stored.
        avatar: photo ? undefined : avatar,
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
    3: { title: 'Your portrait', sub: 'A photo, a mark, or your initials — shown wherever you are.' }
  }

  const previewName = displayName.trim() || 'Your name'
  const previewPortrait = photo ? `photo:${photo.url}` : avatar

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
            <div className="portrait-stage">
              {photo ? (
                <span className="avatar avatar--xl portrait-preview">
                  <img className="avatar-photo" src={photo.url} alt="" draggable={false} />
                </span>
              ) : (
                <Avatar
                  name={previewName}
                  avatar={previewPortrait}
                  size="xl"
                  className="portrait-preview"
                  title="Your portrait"
                />
              )}

              <div className="portrait-stage-text">
                <p className="portrait-name">{previewName}</p>
                <p className="portrait-handle">@{username.trim().toLowerCase() || 'your-handle'}</p>

                <div className="portrait-upload">
                  <input
                    ref={photoRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="portrait-file"
                    onChange={(event) => void pickPhoto(event)}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm w-auto"
                    onClick={() => photoRef.current?.click()}
                  >
                    {photo ? 'Replace photo' : 'Upload photo'}
                  </button>
                  {photo && (
                    <button type="button" className="link-quiet portrait-clear" onClick={clearPhoto}>
                      Remove
                    </button>
                  )}
                </div>
                <p className="portrait-note">PNG, JPEG or WebP · up to 6 MB</p>
              </div>
            </div>

            {portraitError && (
              <div className="auth-actions auth-actions--stack">
                <Notice>{portraitError}</Notice>
              </div>
            )}

            <div className="portrait-or" role="separator" aria-label="or choose a mark">
              <span>or choose a mark</span>
            </div>

            <div className="portrait-grid" role="radiogroup" aria-label="Choose a portrait">
              {AVATAR_MARKS.map((mark) => {
                const value = `mark:${mark.id}`
                const selected = !photo && avatar === value
                return (
                  <button
                    key={mark.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={mark.label}
                    title={mark.label}
                    className={`portrait-choice${selected ? ' is-selected' : ''}`}
                    onClick={() => {
                      clearPhoto()
                      setAvatar(value)
                    }}
                  >
                    <Avatar name={previewName} avatar={value} size="lg" />
                  </button>
                )
              })}

              <button
                type="button"
                role="radio"
                aria-checked={!photo && avatar === 'initials'}
                aria-label="My initials"
                title="My initials"
                className={`portrait-choice portrait-choice--initials${
                  !photo && avatar === 'initials' ? ' is-selected' : ''
                }`}
                onClick={() => {
                  clearPhoto()
                  setAvatar('initials')
                }}
              >
                <Avatar name={previewName} avatar="initials" size="lg" />
              </button>
            </div>

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
          The photo is copied into the app on this PC. Nothing is uploaded.
        </p>
      )}
    </AuthLayout>
  )
}
