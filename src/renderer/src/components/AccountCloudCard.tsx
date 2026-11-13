import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AccountState } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import { useSession } from '../lib/session'
import Button from './Button'
import Notice from './Notice'
import PasswordField from './PasswordField'
import TextField from './TextField'
import { useToast } from './ToastProvider'

/*
 * The INDRA account: the identity the server knows.
 *
 * Everything else in this panel edits the account on this PC. This card is the
 * one that connects it to a human: an email and a password the server verifies,
 * a sealed session kept here, and a profile every other machine can find.
 *
 * Two ways in, because both are needed:
 *   • "Create my INDRA account" — for the account already signed in on this PC.
 *     The local password is checked first, so this cannot be used by somebody
 *     else sitting at the keyboard, and it is then used once to create the
 *     server account with the same address. The address match is what keeps the
 *     existing projects attached to the same person.
 *   • "Sign in to another" — for the second PC, or for a person who already has
 *     an account somewhere else.
 *
 * Nothing here is trusted: the main process checks the password, talks to
 * Supabase, and decides what the session is. This only collects two strings.
 */
export default function AccountCloudCard() {
  const { user, refresh } = useSession()
  const toast = useToast()
  const navigate = useNavigate()

  const [state, setState] = useState<AccountState | null>(null)
  const [mode, setMode] = useState<'create' | 'signin'>('create')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    void api.account
      .state()
      .then(setState)
      .catch(() => setState(null))
  }, [])

  useEffect(() => {
    load()
  }, [load, user?.id])

  async function finish(run: () => Promise<{ state: AccountState }>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await run()
      setPassword('')
      setState(result.state)
      // The sign-in mirrored the profile into this PC's account row; re-reading
      // the session is what makes the name and picture update everywhere.
      await refresh()
      toast.success('INDRA account connected.')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!password) {
      setError('Enter your password.')
      return
    }
    if (mode === 'create') {
      await finish(() => api.account.createFromLocal(password))
      return
    }
    const address = email.trim() || user?.email || ''
    if (!address.includes('@')) {
      setError('Enter the email address of your INDRA account.')
      return
    }
    await finish(() => api.account.signIn({ email: address, password }))
  }

  async function disconnect(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api.account.signOut()
      await refresh()
      navigate('/login', { replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  if (!state) {
    return (
      <section className="account-section" aria-busy="true">
        <h3 className="account-subhead">INDRA account</h3>
        <p className="account-cloud-note">Checking this PC’s connection to your account…</p>
      </section>
    )
  }

  if (state.connected) {
    return (
      <section className="account-section">
        <h3 className="account-subhead">INDRA account</h3>

        <p className="account-cloud-note">
          {state.email ? (
            <>
              Connected as <strong>{state.email}</strong>
              {state.memberNo ? ` · ${state.memberNo}` : ''}
              {state.role === 'admin' ? ' · administrator' : ''}
            </>
          ) : (
            'Connected.'
          )}
        </p>

        <p className="account-cloud-note">
          {state.stale
            ? 'The session has expired. Sign out and sign in again to keep working with the server.'
            : 'This PC holds a sealed session. Your password is not stored anywhere.'}
          {state.sealed ? '' : ' This PC’s keystore is unavailable, so the session is not encrypted.'}
        </p>

        {error && <Notice>{error}</Notice>}

        <div className="mt-3">
          <button
            type="button"
            className="btn btn-ghost btn-sm w-auto"
            onClick={() => void disconnect()}
            disabled={busy}
          >
            {busy ? 'Signing out…' : 'Sign out of INDRA'}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="account-section">
      <h3 className="account-subhead">INDRA account</h3>

      <p className="account-cloud-note">
        {mode === 'create'
          ? `Create your INDRA account with ${user?.email ?? 'the address on this PC'}. You will use it to sign in on any other PC.`
          : 'Sign in to an INDRA account. On a new PC this brings your profile and, once syncing lands, your projects with it.'}
      </p>

      <form onSubmit={(event) => void submit(event)} noValidate>
        <div className="account-form">
          {mode === 'signin' && (
            <TextField
              label="Email"
              name="account-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={user?.email ?? 'you@example.com'}
              autoComplete="email"
              spellCheck={false}
              disabled={busy}
            />
          )}

          <PasswordField
            label="Password"
            name="account-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={mode === 'create' ? 'This account’s password' : 'Your INDRA password'}
            autoComplete={mode === 'create' ? 'current-password' : 'current-password'}
            disabled={busy}
          />
        </div>

        {error && <Notice>{error}</Notice>}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" loading={busy}>
            {mode === 'create' ? 'Create my INDRA account' : 'Sign in'}
          </Button>
          <button
            type="button"
            className="link-quiet"
            onClick={() => {
              setMode(mode === 'create' ? 'signin' : 'create')
              setError(null)
              setPassword('')
            }}
            disabled={busy}
          >
            {mode === 'create' ? 'I already have an INDRA account' : 'Use the account on this PC'}
          </button>
        </div>
      </form>
    </section>
  )
}
