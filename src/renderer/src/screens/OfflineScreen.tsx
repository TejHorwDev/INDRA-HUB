import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import Notice from '../components/Notice'
import { api, errorMessage } from '../lib/api'
import { useSession } from '../lib/session'

/**
 * What a machine with no route out opens on.
 *
 * Not a sign-in form with a warning under it: no credential is accepted here at
 * all, because signing in is an online act. What is on offer is the offline
 * workspace — the writing tools, the decks, and everything saved on this PC —
 * and one way back to the account, which is to find a connection.
 */
export default function OfflineScreen() {
  const navigate = useNavigate()
  const { refresh } = useSession()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function goOffline(): Promise<void> {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await api.offline.start()
      await refresh()
      navigate('/documents', { replace: true })
    } catch (failure) {
      setError(errorMessage(failure))
      setPending(false)
    }
  }

  return (
    <AuthLayout>
      <p className="auth-eyebrow">Offline</p>
      <h1 className="auth-title">Work offline</h1>

      <div className="auth-rule" />

      <p className="auth-lede">
        This PC has no connection, and signing in needs one. What still works is the writing:
        documents and presentations, saved here as you go.
      </p>

      <div className="mt-6 space-y-3">
        <button type="button" className="btn btn-primary" onClick={() => void goOffline()} disabled={pending}>
          {pending ? <span className="spinner" aria-hidden="true" /> : null}
          {pending ? 'Opening…' : 'Go offline'}
        </button>
        {error && <Notice>{error}</Notice>}
      </div>

      <p className="auth-alt">
        When the connection returns, sign in and bring this work into your account from the projects
        screen.
      </p>
    </AuthLayout>
  )
}
