import { useCallback, useEffect, useRef, useState } from 'react'
import type { UpdateDiagnostics, UpdateState } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import { useToast } from './ToastProvider'
import { CheckIcon, XIcon } from './icons'

/**
 * Settings → Updates.
 *
 * The main process owns the updater and pushes progress here; this panel only
 * renders what it reports and offers the two actions a person needs: check
 * now, and restart once a download has finished.
 */
export default function UpdatesPanel() {
  const toast = useToast()
  const [state, setState] = useState<UpdateState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** The on-demand report, so "does it work?" is answered rather than hoped. */
  const [diagnostics, setDiagnostics] = useState<UpdateDiagnostics | null>(null)
  const [testing, setTesting] = useState(false)
  /** Guards against re-announcing the same ready version on every re-render. */
  const announced = useRef<string | null>(null)

  useEffect(() => {
    let active = true

    api.updates
      .state()
      .then((initial) => {
        if (active) setState(initial)
      })
      .catch(() => {
        // The panel simply stays empty; nothing here is critical.
      })

    const unsubscribe = api.updates.onState((next) => {
      if (active) setState(next)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!state || state.phase !== 'ready' || !state.version) return
    if (announced.current === state.version) return
    announced.current = state.version
    toast.success(`Version ${state.version} is ready — restart to apply it.`)
  }, [state, toast])

  const check = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setState(await api.updates.check())
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }, [])

  const test = useCallback(async () => {
    setTesting(true)
    setError(null)
    try {
      setDiagnostics(await api.updates.diagnose())
    } catch (failure) {
      setError(errorMessage(failure))
      setDiagnostics(null)
    } finally {
      setTesting(false)
    }
  }, [])

  const install = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await api.updates.install()
    } catch (failure) {
      setError(errorMessage(failure))
      setBusy(false)
    }
  }, [])

  const phase = state?.phase ?? 'idle'
  const downloading = phase === 'downloading' || phase === 'available'
  const ready = phase === 'ready'
  const upToDate = phase === 'up-to-date'
  const failed = phase === 'error'
  const unsupported = phase === 'unsupported'

  const headline = ((): string => {
    switch (phase) {
      case 'unsupported':
        return 'Updates are unavailable in this build.'
      case 'checking':
        return 'Checking for updates…'
      case 'available':
        return state?.version ? `Version ${state.version} is downloading…` : 'An update is downloading…'
      case 'downloading':
        return state?.version ? `Downloading version ${state.version}…` : 'Downloading the update…'
      case 'ready':
        return state?.version ? `Version ${state.version} is ready — restart to apply it.` : 'An update is ready.'
      case 'up-to-date':
        return 'You are on the newest version.'
      case 'error':
        return 'The update could not be completed.'
      default:
        return state && state.checkedAt ? 'No updates were found.' : 'Not checked yet.'
    }
  })()

  const detail = failed
    ? (error ?? state?.message ?? 'Try again later.')
    : (state?.message ?? (unsupported ? 'Install the app to receive updates.' : null))

  /** So the exact failure can be pasted somewhere, not retyped from a photo. */
  const copyDetails = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(
        `${headline}\n${detail ?? ''}\n${text}\nversion ${state?.currentVersion ?? '?'} · checked ${state?.checkedAt ?? 'never'}`
      )
      toast.success('Details copied.')
    } catch {
      toast.error('Could not copy the details.')
    }
  }

  // The technical reason, when there is one. Small, and never instead of the
  // sentence above it — but it is the difference between "it broke" and a fix.
  const technicalDetail = failed ? (state?.detail ?? null) : null

  const percent = state?.percent ?? 0
  const speed = state?.bytesPerSecond ?? 0

  return (
    <div className="account-section">
      <h3 className="account-subhead">Application updates</h3>

      <p className="account-note">
        INDRA HUB updates itself from its release page. It checks as it starts, again when you
        come back to the window, and every few hours while it stays open. An update is a couple of
        megabytes rather than a whole installer, it downloads quietly, and it takes effect the next
        time the app starts — no installer to run, no wizard, no download page. Your projects,
        accounts and activation keys are never touched by an update.
      </p>

      <dl className="account-meta">
        <div>
          <dt>Installed version</dt>
          <dd className="update-version">{state?.currentVersion ?? '—'}</dd>
        </div>
        <div>
          <dt>Installed build</dt>
          <dd>
            {state?.installedVersion ?? '—'}
            {state && state.currentVersion !== state.installedVersion && (
              <span className="badge badge--muted" title="An in-app update is running; the installer on disk is older">
                running {state.currentVersion}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>{ready ? 'Ready to install' : 'Last checked'}</dt>
          <dd>
            {ready && state?.version
              ? state.version
              : state?.checkedAt
                ? new Date(state.checkedAt).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short'
                  })
                : '—'}
          </dd>
        </div>
      </dl>

      {downloading && (
        <div>
          <div
            className="update-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="Update download progress"
          >
            <div className="update-progress-bar" style={{ width: `${percent}%` }} />
          </div>
          <p className="update-hint">
            {percent}%
            {speed > 0 ? ` · ${formatSpeed(speed)}` : ''} · you can keep working
          </p>
        </div>
      )}

      <p className={`update-hint${failed ? ' update-hint--error' : ''}`} role={failed ? 'alert' : undefined}>
        {headline}
        {detail && detail !== headline ? ` ${detail}` : ''}
      </p>

      {technicalDetail && (
        <div className="update-technical-row">
          <p className="update-hint update-technical" title="The exact error, for reporting">
            {technicalDetail}
          </p>
          <button
            type="button"
            className="btn btn-ghost btn-sm w-auto"
            onClick={() => void copyDetails(technicalDetail)}
          >
            Copy
          </button>
        </div>
      )}

      <div className="account-actions">
        {ready ? (
          <button type="button" className="btn btn-primary w-auto" onClick={() => void install()} disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? 'Restarting…' : 'Restart and update'}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-ghost w-auto"
            onClick={() => void check()}
            disabled={busy || unsupported || downloading || !state?.canCheck}
          >
            {busy || phase === 'checking' ? <span className="spinner" aria-hidden="true" /> : null}
            {busy || phase === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        )}

        <button
          type="button"
          className="btn btn-ghost btn-sm w-auto"
          onClick={() => void test()}
          disabled={testing || unsupported || !state?.canCheck}
          title="Make the same requests an update would make, and show what came back"
        >
          {testing ? <span className="spinner" aria-hidden="true" /> : null}
          {testing ? 'Testing…' : 'Test connection'}
        </button>

        {upToDate && <span className="badge badge--accent">Up to date</span>}
      </div>

      {diagnostics && (
        <div className="update-diagnostics">
          <h4 className="update-diagnostics-title">
            {diagnostics.ok ? 'The update path works' : 'The update path is blocked'}
          </h4>
          <ul className="update-diagnostics-list">
            {diagnostics.steps.map((step) => (
              <li key={step.label} className={step.ok ? 'is-ok' : 'is-bad'}>
                <span className="update-diagnostics-mark" aria-hidden="true">
                  {step.ok ? <CheckIcon size={11} /> : <XIcon size={11} />}
                </span>
                <span className="update-diagnostics-label">{step.label}</span>
                <span className="update-diagnostics-detail">{step.detail}</span>
                <span className="sr-only">{step.ok ? 'ok' : 'failed'}</span>
              </li>
            ))}
          </ul>
          <p className="update-hint">{diagnostics.summary}</p>
          <p className="update-hint update-technical">
            {new Date(diagnostics.checkedAt).toLocaleString()} · running{' '}
            {diagnostics.currentVersion}
            {diagnostics.latestVersion ? ` · newest ${diagnostics.latestVersion}` : ''}
          </p>
        </div>
      )}
    </div>
  )
}

function formatSpeed(bytesPerSecond: number): string {
  const megabytes = bytesPerSecond / (1024 * 1024)
  if (megabytes >= 1) return `${megabytes.toFixed(1)} MB/s`
  return `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`
}
