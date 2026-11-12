import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAppStatus } from '../lib/appStatus'
import { useSession } from '../lib/session'
import { CheckIcon, SignOutIcon } from '../components/icons'

/**
 * What a signed-in account finds while the administrator has maintenance on.
 *
 * It appears *after* signing in, never instead of signing in: the front door is
 * always open, and this is what a session meets on the other side. Nothing here
 * points at the administration area.
 *
 * The screen is deliberately not a dead end — it names the account, says that
 * the app is checking itself, and offers one honest action.
 */
export default function MaintenanceScreen({
  message,
  onSignOut
}: {
  message: string
  onSignOut?: () => void
}): ReactNode {
  const { refresh } = useAppStatus()
  const { user } = useSession()
  const [checking, setChecking] = useState(false)
  const [checkedAt, setCheckedAt] = useState<Date>(() => new Date())

  const check = useCallback(async () => {
    setChecking(true)
    try {
      await refresh()
    } finally {
      setCheckedAt(new Date())
      // A short floor so the state is visible rather than a flicker.
      window.setTimeout(() => setChecking(false), 320)
    }
  }, [refresh])

  // The status provider already polls; keep this clock in step with it.
  useEffect(() => {
    const timer = window.setInterval(() => setCheckedAt(new Date()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="maintenance-canvas">
      <div className="maintenance-card stagger">
        <header className="maintenance-head">
          <span className="maintenance-eyebrow">
            <span className="maintenance-dot" aria-hidden="true" />
            Maintenance
          </span>
          <span className="maintenance-pill">
            <span className="maintenance-pill-dot" aria-hidden="true" />
            Checking automatically
          </span>
        </header>

        <h1 className="maintenance-title">Be right back.</h1>

        <p className="maintenance-lede">
          INDRA HUB is temporarily unavailable while the administrator carries out maintenance.
        </p>

        <blockquote className="maintenance-message" aria-live="polite">
          {message || 'The administrator has not left a message.'}
        </blockquote>

        <dl className="maintenance-facts">
          <div>
            <dt>Signed in as</dt>
            <dd>{user ? `@${user.username}` : 'this device'}</dd>
          </div>
          <div>
            <dt>Workspace</dt>
            <dd>Closed</dd>
          </div>
          <div>
            <dt>Last checked</dt>
            <dd>
              {checkedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </dd>
          </div>
        </dl>

        <p className="maintenance-note">
          Your account, projects and documents are untouched. This screen clears itself the moment
          the administrator reopens the app.
        </p>

        <div className="maintenance-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void check()}
            disabled={checking}
          >
            {checking ? <span className="spinner" aria-hidden="true" /> : <CheckIcon size={13} />}
            {checking ? 'Checking…' : 'Check now'}
          </button>

          {onSignOut && (
            <button type="button" className="btn btn-subtle btn-sm" onClick={onSignOut}>
              <SignOutIcon size={13} />
              Sign out
            </button>
          )}

          <span className="maintenance-mark" aria-hidden="true">
            INDRA HUB
          </span>
        </div>

        <div className="maintenance-track" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  )
}
