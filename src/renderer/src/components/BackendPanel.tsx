import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { BackendStatus } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import { useToast } from './ToastProvider'
import TextField from './TextField'

/**
 * Settings → Backend.
 *
 * Stores the Supabase project URL and its public key, then proves they work.
 * Nothing but the configured project is sent anywhere from here — syncing
 * arrives with authentication, see docs/SUPABASE.md.
 */
export default function BackendPanel() {
  const toast = useToast()

  const [status, setStatus] = useState<BackendStatus | null>(null)
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<'save' | 'test' | 'clear' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    api.backend
      .status()
      .then((current) => {
        if (!active) return
        setStatus(current)
        setUrl(current.url ?? '')
      })
      .catch((failure) => {
        if (active) setError(errorMessage(failure))
      })
    return () => {
      active = false
    }
  }, [])

  const save = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setError(null)
      if (!url.trim() || !key.trim()) {
        setError('Enter both the project URL and its public key.')
        return
      }

      setBusy('save')
      try {
        const next = await api.backend.save({ url: url.trim(), key: key.trim() })
        setStatus(next)
        setKey('')
        if (next.reachable) toast.success('Connected to Supabase.')
        else toast.error(next.message ?? 'The project could not be reached.')
      } catch (failure) {
        setError(errorMessage(failure))
      } finally {
        setBusy(null)
      }
    },
    [key, toast, url]
  )

  const test = useCallback(async () => {
    setError(null)
    setBusy('test')
    try {
      setStatus(await api.backend.test())
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(null)
    }
  }, [])

  const clear = useCallback(async () => {
    setError(null)
    setBusy('clear')
    try {
      setStatus(await api.backend.clear())
      setUrl('')
      setKey('')
      toast.info('Supabase connection removed.')
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(null)
    }
  }, [toast])

  const connected = Boolean(status?.configured)
  const reachable = status?.reachable

  return (
    <div className="account-section">
      <h3 className="account-subhead">Supabase</h3>

      <p className="account-note">
        Optional. INDRA HUB keeps every account, project and document in a local database on this
        machine, and it works with no connection at all. Connecting a Supabase project adds a
        cloud copy — the app will not depend on it.
      </p>

      <dl className="account-meta">
        <div>
          <dt>Status</dt>
          <dd>
            {!connected
              ? 'Not connected'
              : reachable === true
                ? 'Connected'
                : reachable === false
                  ? 'Configured, unreachable'
                  : 'Configured'}
          </dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>{status?.url ?? '—'}</dd>
        </div>
        <div>
          <dt>Key</dt>
          <dd>
            {status?.keyHint ?? '—'}
            {status?.keySealed && (
              <span className="badge badge--muted" title="Sealed with the operating system keystore">
                sealed
              </span>
            )}
          </dd>
        </div>
      </dl>

      {status?.message && (
        <p
          className={`update-hint${reachable === false ? ' update-hint--error' : ''}`}
          role={reachable === false ? 'alert' : undefined}
        >
          {status.message}
        </p>
      )}

      <form onSubmit={save} noValidate>
        <div className="account-form">
          <TextField
            label="Project URL"
            name="backend-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://your-project.supabase.co"
            autoComplete="off"
            spellCheck={false}
            disabled={busy !== null}
          />
          <TextField
            label={connected ? 'Replace public key' : 'Public key (anon)'}
            name="backend-key"
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={connected ? 'Leave empty to keep the stored key' : 'eyJhbGciOi…'}
            autoComplete="off"
            spellCheck={false}
            disabled={busy !== null}
            hint={
              <p className="field-hint">
                Use the <strong>anon / public</strong> key. The service_role key bypasses every
                security policy and this app refuses to store it.
              </p>
            }
          />
        </div>

        {error && (
          <p className="update-hint update-hint--error" role="alert">
            {error}
          </p>
        )}

        <div className="account-actions">
          <button type="submit" className="btn btn-primary w-auto" disabled={busy !== null}>
            {busy === 'save' && <span className="spinner" aria-hidden="true" />}
            {busy === 'save' ? 'Testing…' : 'Save and test'}
          </button>

          {connected && (
            <>
              <button
                type="button"
                className="btn btn-ghost w-auto"
                onClick={() => void test()}
                disabled={busy !== null}
              >
                {busy === 'test' && <span className="spinner" aria-hidden="true" />}
                {busy === 'test' ? 'Testing…' : 'Test again'}
              </button>
              <button
                type="button"
                className="btn btn-ghost w-auto"
                onClick={() => void clear()}
                disabled={busy !== null}
              >
                {busy === 'clear' ? 'Removing…' : 'Disconnect'}
              </button>
            </>
          )}
        </div>
      </form>

      <p className="update-hint">
        The tables must exist before the test succeeds. Run <code>supabase/schema.sql</code> in the
        Supabase SQL editor first — the full walkthrough is in <code>docs/SUPABASE.md</code>.
      </p>
    </div>
  )
}
