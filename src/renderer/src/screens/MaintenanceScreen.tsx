import { Link } from 'react-router-dom'

/**
 * Shown instead of the workspace while the administrator has maintenance on.
 * The gate is also enforced in the main process for every data call.
 */
export default function MaintenanceScreen({ message }: { message: string }) {
  return (
    <div className="maintenance-canvas">
      <div className="maintenance-panel stagger">
        <p className="micro-label">Maintenance</p>
        <h1 className="auth-title mt-2">Be right back</h1>
        <p className="maintenance-copy">
          {message || 'INDRA HUB is temporarily unavailable while maintenance is carried out.'}
        </p>
        <p className="maintenance-note">
          Your account, projects and documents are untouched. This screen clears itself as soon as
          the administrator reopens the app.
        </p>
        <Link to="/admin" className="link maintenance-link">
          Administrator sign-in
        </Link>
      </div>
    </div>
  )
}
