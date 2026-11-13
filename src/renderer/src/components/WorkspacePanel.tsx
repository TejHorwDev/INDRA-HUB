import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { WorkspaceState } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import PasswordField from './PasswordField'
import TextField from './TextField'
import { useToast } from './ToastProvider'

/*
 * Admin → Backend → Shared workspace.
 *
 * The workspace is one row in the project this build points at. Every
 * installation reads it and mirrors it into its own database, so a switch set
 * here is what a machine installed tomorrow starts with, and a change reaches
 * the ones already running within seconds.
 *
 * Two things this panel must never do: show a token, and claim the workspace
 * without the one-time setup code. The code is the only thing that decides
 * *which* account gets to own the row, and it stops working the moment it is
 * used.
 */

const TRANSPORT_COPY: Record<
  WorkspaceState['transport'],
  { label: string; tone: string; short: string; detail: string }
> = {
  live: {
    label: 'Live',
    tone: 'good',
    short: 'Live socket',
    detail: 'Subscribed to the workspace row — changes arrive as they happen.'
  },
  polling: {
    label: 'Syncing',
    tone: 'warn',
    short: 'Polling',
    detail: 'A live socket is not available, so the app is checking every few seconds.'
  },
  offline: {
    label: 'Offline',
    tone: 'bad',
    short: 'Offline',
    detail: 'Running on the settings stored on this machine. It will catch up when the connection returns.'
  }
}

function stamp(value: string | null): string {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Never'
  const sameDay = new Date().toDateString() === date.toDateString()
  return sameDay ? date.toLocaleTimeString() : date.toLocaleDateString()
}

export default function WorkspacePanel() {
  const toast = useToast()

  const [state, setState] = useState<WorkspaceState | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'sign-in' | 'sign-up' | 'claim' | 'sync' | 'sign-out' | null>(null)

  const adopt = useCallback((next: WorkspaceState) => setState(next), [])

  useEffect(() => {
    let active = true
    api.workspace
      .state()
      .then((current) => {
        if (active) adopt(current)
      })
      .catch((failure) => {
        if (active) setError(errorMessage(failure))
      })
    const off = api.workspace.onChange((next) => {
      if (active) adopt(next)
    })
    return () => {
      active = false
      off()
    }
  }, [adopt])

  const run = useCallback(
    async (
      kind: NonNullable<typeof busy>,
      action: () => Promise<WorkspaceState>,
      success?: string
    ) => {
      setError(null)
      setBusy(kind)
      try {
        const next = await action()
        adopt(next)
        if (success) toast.success(success)
        return next
      } catch (failure) {
        setError(errorMessage(failure))
        return null
      } finally {
        setBusy(null)
      }
    },
    [adopt, toast]
  )

  const signIn = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void run('sign-in', () => api.workspace.signIn({ email, password }), 'Signed in to the workspace.').then(
      (next) => {
        if (next) setPassword('')
      }
    )
  }

  const signUp = (): void => {
    void run('sign-up', () => api.workspace.signUp({ email, password }), 'Workspace account created.').then(
      (next) => {
        if (next) setPassword('')
      }
    )
  }

  const claim = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void run('claim', () => api.workspace.claim({ code }), 'Workspace claimed. This account now owns it.').then(
      (next) => {
        if (next?.owner) setCode('')
      }
    )
  }

  const transport = state ? TRANSPORT_COPY[state.transport] : TRANSPORT_COPY.offline

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <h2>Shared workspace</h2>
        {state && (
          <span
            className={`admin-status ${transport.tone === 'good' ? 'admin-status--good' : transport.tone === 'warn' ? 'admin-status--accent' : 'admin-status--alert'}`}
            title={transport.detail}
          >
            {transport.label}
          </span>
        )}
      </div>

      <div className="admin-card-body">
        <p className="admin-hint">
          Maintenance, registrations, activation keys and the sign-in video are written to one shared
          row. Every PC reads that row, so a change here appears everywhere within seconds — and an
          installation started tomorrow begins with it instead of with defaults. Each machine also
          keeps its own copy, so the app opens and signs in with no connection at all.
        </p>

        {!state && <p className="admin-hint">Reading the workspace…</p>}

        {state && !state.configured && (
          <p className="admin-error" role="alert">
            No workspace endpoint is configured on this machine.
          </p>
        )}

        {state && state.configured && (
          <dl className="admin-facts">
            <div>
              <dt>Endpoint</dt>
              <dd title={state.url ?? ''}>{state.builtIn ? 'Built into this build' : (state.url ?? 'Custom')}</dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>{state.signedIn ? state.email : 'Not signed in'}</dd>
            </div>
            <div>
              <dt>Published revision</dt>
              <dd>{state.revision ?? '—'}</dd>
            </div>
            <div>
              <dt>Running revision</dt>
              <dd>{state.appliedRevision ?? '—'}</dd>
            </div>
            <div>
              <dt>Last sync</dt>
              <dd>{stamp(state.lastSyncAt)}</dd>
            </div>
            <div>
              <dt>Transport</dt>
              <dd title={transport.detail}>{transport.short}</dd>
            </div>
          </dl>
        )}

        {state?.pending && (
          <div className="admin-callout">
            <p>
              A change on this machine has not reached the workspace yet. It is applied here, and will
              publish as soon as the connection allows.
            </p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void run('sync', () => api.workspace.discard(), 'Local change discarded.')}
              disabled={busy !== null}
            >
              Use the shared version instead
            </button>
          </div>
        )}

        {error && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}

        {state?.lastError && !error && (
          <p className="admin-error" role="alert">
            {state.lastError}
          </p>
        )}

        {state?.configured && !state.signedIn && (
          <form className="admin-form" onSubmit={signIn}>
            <div className="admin-form-grid">
              <TextField
                label="Workspace email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                autoComplete="username"
                spellCheck={false}
                disabled={busy !== null}
              />

              <PasswordField
                label="Workspace password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                autoComplete="current-password"
                disabled={busy !== null}
              />
            </div>

            <p className="admin-hint">
              One account owns the workspace. Create it here the first time — it is not the local
              administrator password, and it is never stored on this machine: only its session is,
              sealed with the operating system keystore. Until an account claims it, the workspace row
              belongs to nobody and this PC stays in charge of its own settings.
            </p>

            <div className="admin-form-actions admin-form-actions--start">
              <button type="submit" className="btn btn-primary w-auto" disabled={busy !== null || !email.trim() || !password}>
                {busy === 'sign-in' && <span className="spinner" aria-hidden="true" />}
                {busy === 'sign-in' ? 'Signing in…' : 'Sign in'}
              </button>
              <button
                type="button"
                className="btn btn-ghost w-auto"
                onClick={signUp}
                disabled={busy !== null || !email.trim() || password.length < 8}
              >
                {busy === 'sign-up' && <span className="spinner" aria-hidden="true" />}
                Create owner account
              </button>
            </div>
          </form>
        )}

        {state?.signedIn && state.claimable && (
          <form className="admin-form" onSubmit={claim}>
            <p className="admin-hint">
              Signed in as <strong>{state.email}</strong>. This workspace has no owner yet: enter the
              one-time setup code once, on this machine, and this account owns it from then on. What
              this machine is using right now — maintenance, registration and the sign-in video — is
              published to every other PC at that moment. Other machines never need to claim anything.
            </p>
            <TextField
              label="Setup code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="IH-XXXX-XXXX-XXXX-XXXX"
              spellCheck={false}
              autoComplete="off"
              disabled={busy !== null}
            />
            <div className="admin-form-actions admin-form-actions--start">
              <button type="submit" className="btn btn-primary w-auto" disabled={busy !== null || code.trim().length < 8}>
                {busy === 'claim' && <span className="spinner" aria-hidden="true" />}
                {busy === 'claim' ? 'Claiming…' : 'Claim this workspace'}
              </button>
            </div>
          </form>
        )}

        {state?.signedIn && !state.claimable && !state.owner && (
          <p className="admin-hint">
            Signed in as <strong>{state.email}</strong>, which does not own this workspace. Every
            installation still receives the settings; only the owning account can change them.
          </p>
        )}

        {state?.signedIn && state.owner && (
          <div className="admin-form-actions admin-form-actions--start">
            <button
              type="button"
              className="btn btn-primary w-auto"
              onClick={() => void run('sync', () => api.workspace.sync(), 'Workspace synced.')}
              disabled={busy !== null}
            >
              {busy === 'sync' && <span className="spinner" aria-hidden="true" />}
              {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              type="button"
              className="btn btn-ghost w-auto"
              onClick={() => void run('sign-out', () => api.workspace.signOut(), 'Signed out of the workspace.')}
              disabled={busy !== null}
            >
              Sign out of workspace
            </button>
          </div>
        )}

        {state?.signedIn && !state.owner && (
          <div className="admin-form-actions admin-form-actions--start">
            <button
              type="button"
              className="btn btn-ghost w-auto"
              onClick={() => void run('sign-out', () => api.workspace.signOut(), 'Signed out of the workspace.')}
              disabled={busy !== null}
            >
              Sign out of workspace
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
