import type { ReactNode } from 'react'

/**
 * Shown to a signed-in account while the administrator has maintenance on.
 *
 * It appears *after* signing in, never instead of signing in: the front door is
 * always open, and this is what a session finds on the other side of it. There
 * is no route from here to the administration area — the panel is reached by
 * someone who already knows the shortcut.
 */
export default function MaintenanceScreen({
  message,
  onSignOut
}: {
  message: string
  onSignOut?: () => void
}): ReactNode {
  return (
    <div className="maintenance-canvas">
      <div className="maintenance-panel stagger">
        <p className="micro-label">Maintenance</p>
        <h1 className="auth-title mt-2">Be right back</h1>
        <p className="maintenance-copy">
          {message || 'INDRA HUB is temporarily unavailable while maintenance is carried out.'}
        </p>
        <p className="maintenance-note">
          You are signed in. Your account, projects and documents are untouched, and this screen
          clears itself as soon as the administrator reopens the app.
        </p>
        {onSignOut && (
          <button type="button" className="link maintenance-link" onClick={onSignOut}>
            Sign out
          </button>
        )}
      </div>
    </div>
  )
}
