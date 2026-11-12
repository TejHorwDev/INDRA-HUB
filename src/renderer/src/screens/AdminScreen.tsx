import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { AdminAccount, AdminOverview } from '@shared/types'
import Button from '../components/Button'
import Notice from '../components/Notice'
import PasswordField from '../components/PasswordField'
import TextField from '../components/TextField'
import { ChevronLeftIcon, InfoIcon } from '../components/icons'
import { ApiError, api, errorCode, errorMessage } from '../lib/api'
import AdminPanel from './admin/AdminPanel'

type Phase = 'loading' | 'setup' | 'login' | 'panel'

/**
 * Slim bar for the gate screens only. Once the administrator is signed in the
 * console draws its own identity and exits in the rail, so this would be a
 * second header saying the same thing.
 */
function AdminBar() {
  return (
    <header className="admin-topbar">
      <span className="admin-scope">Restricted area</span>
      <div className="admin-topbar-actions">
        <Link to="/dashboard" className="admin-exit">
          <ChevronLeftIcon size={13} />
          Back to app
        </Link>
      </div>
    </header>
  )
}

export default function AdminScreen() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [admin, setAdmin] = useState<AdminAccount | null>(null)
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [gateError, setGateError] = useState<string | null>(null)

  /** Re-reads the admin session and the whole overview from the main process. */
  const sync = useCallback(async () => {
    const status = await api.admin.status()
    if (!status.configured) {
      setPhase('setup')
      return
    }
    if (!status.signedIn || !status.admin) {
      setPhase('login')
      return
    }

    const data = await api.admin.overview()
    setAdmin(status.admin)
    setOverview(data)
    setPhase('panel')
  }, [])

  const refresh = useCallback(async () => {
    try {
      await sync()
    } catch (error) {
      setGateError(errorMessage(error))
      setPhase('login')
    }
  }, [sync])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /*
   * The workspace can change from another machine while this panel is open.
   * Re-reading the overview is what updates the switches, the chips and the
   * appearance section — without disturbing the section being looked at.
   */
  useEffect(() => {
    const off = api.workspace.onChange(() => {
      void refresh().catch(() => undefined)
    })
    return off
  }, [refresh])

  async function handleSignOut() {
    try {
      await api.admin.signOut()
    } finally {
      setAdmin(null)
      setOverview(null)
      setGateError(null)
      setPhase('login')
    }
  }

  return (
    <div className="admin-shell">
      {/* The console carries its own identity and actions once signed in; the
          gate screens keep the slim bar. */}
      {phase !== 'panel' && <AdminBar />}

      <div className={`admin-scroll${phase === 'panel' ? ' admin-scroll--flush' : ''}`}>
        {phase === 'loading' && (
          <div className="admin-gate" aria-busy="true" aria-label="Checking administrator access">
            <span className="spinner" aria-hidden="true" />
          </div>
        )}

        {phase === 'setup' && (
          <SetupForm
            onCreated={async () => {
              await refresh()
            }}
          />
        )}

        {phase === 'login' && (
          <LoginForm
            initialError={gateError}
            onSignedIn={async () => {
              setGateError(null)
              await refresh()
            }}
          />
        )}

        {phase === 'panel' && admin && overview && (
          <AdminPanel
            admin={admin}
            overview={overview}
            refresh={refresh}
            onSignOut={() => void handleSignOut()}
          />
        )}

        {phase === 'panel' && (!admin || !overview) && (
          <div className="admin-gate">
            <Notice>Could not load the administration overview.</Notice>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* First-run setup                                                     */
/* ------------------------------------------------------------------ */

function SetupForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setFieldError(null)

    if (!allFieldsFilled(displayName, email, password, confirmPassword)) {
      setFieldError({ field: 'password', message: 'Complete every field to continue.' })
      return
    }
    if (password !== confirmPassword) {
      setFieldError({ field: 'confirmPassword', message: 'The two passwords do not match.' })
      return
    }

    setPending(true)
    try {
      await api.admin.setup({
        displayName: displayName.trim(),
        email: email.trim(),
        password,
        confirmPassword
      })
      await onCreated()
    } catch (error) {
      if (errorCode(error) === 'VALIDATION') {
        setFieldError({ field: fieldFrom(error), message: errorMessage(error) })
      } else {
        setFormError(errorMessage(error))
      }
      setPending(false)
    }
  }

  const errorFor = (field: string): string | null =>
    fieldError?.field === field ? fieldError.message : null

  return (
    <div className="admin-gate">
      <div className="admin-gate-card">
        <p className="micro-label">First run</p>
        <h1 className="auth-title mt-2">Create the administrator</h1>
        <p className="admin-gate-copy">
          Administration is a separate identity from ordinary accounts. This is the only time it can
          be created on this installation, and it is limited to one Gmail address.
        </p>

        <div className="auth-rule" />

        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-4">
            <TextField
              label="Name"
              name="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              error={errorFor('displayName')}
              placeholder="Your name"
              autoComplete="name"
              autoFocus
              disabled={pending}
            />
            <TextField
              label="Admin Gmail"
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={errorFor('email')}
              placeholder="you@gmail.com"
              autoComplete="email"
              spellCheck={false}
              disabled={pending}
            />
            <PasswordField
              label="Password"
              name="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={errorFor('password')}
              placeholder="At least 10 characters"
              autoComplete="new-password"
              disabled={pending}
            />
            <PasswordField
              label="Confirm password"
              name="confirmPassword"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              error={errorFor('confirmPassword')}
              placeholder="Repeat the password"
              autoComplete="new-password"
              disabled={pending}
            />
          </div>

          <div className="mt-6 space-y-3">
            <Button type="submit" loading={pending}>
              {pending ? 'Creating administrator…' : 'Create administrator'}
            </Button>
            {formError && <Notice>{formError}</Notice>}
          </div>
        </form>

        <p className="admin-gate-copy admin-gate-copy--quiet">
          The password is stored only as a scrypt hash in the local database.
        </p>
      </div>
    </div>
  )
}

function allFieldsFilled(
  displayName: string,
  email: string,
  password: string,
  confirmPassword: string
): boolean {
  return Boolean(displayName.trim() && email.trim() && password && confirmPassword)
}

function fieldFrom(error: unknown): string {
  return error instanceof ApiError ? (error.field ?? 'password') : 'password'
}

/* ------------------------------------------------------------------ */
/* Administrator sign-in                                               */
/* ------------------------------------------------------------------ */

function LoginForm({
  initialError,
  onSignedIn
}: {
  initialError: string | null
  onSignedIn: () => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(initialError)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    if (!email.trim() || !password) {
      setFormError('Enter the administrator email and password.')
      return
    }

    setPending(true)
    try {
      await api.admin.signIn({ email: email.trim(), password })
      await onSignedIn()
    } catch (error) {
      setFormError(errorMessage(error))
      setPending(false)
    }
  }

  return (
    <div className="admin-gate">
      <div className="admin-gate-card">
        <p className="micro-label">Restricted</p>
        <h1 className="auth-title mt-2">Administrator sign-in</h1>
        <p className="admin-gate-copy">
          This area is not part of any normal account. Use the administrator Gmail and password set
          on this installation.
        </p>

        <div className="auth-rule" />

        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-4">
            <TextField
              label="Admin Gmail"
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@gmail.com"
              autoComplete="username"
              spellCheck={false}
              autoFocus
              disabled={pending}
            />
            <PasswordField
              label="Password"
              name="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Administrator password"
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

        <div className="admin-gate-foot">
          <InfoIcon size={13} />
          <span>Failed attempts lock administrator sign-in for 15 minutes.</span>
        </div>
      </div>
    </div>
  )
}
