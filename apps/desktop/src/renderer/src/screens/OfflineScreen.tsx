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

      {/*
       * The one thing this screen is for: say there is no connection, without
       * pretending to be a sign-in form. A password typed here would be checked
       * against a hash on this disk, which proves nothing about anywhere else —
       * so no credential is accepted while the machine has no route out.
       */}
      <div className="auth-offline-mark" aria-hidden="true">
        📡
      </div>

      <h1 className="auth-title">You&rsquo;re offline</h1>

      <div className="auth-rule" />

      <p className="auth-lede">
        This PC has no internet right now, and signing in needs one.
      </p>
      <p className="auth-lede">
        What still works is the writing: <strong>documents</strong> and <strong>presentations</strong>, saved on this
        PC as you type. No credits, no team, no cloud — just the page in front of you.
      </p>

      <div className="mt-6 space-y-3">
        <button type="button" className="btn btn-primary" onClick={() => void goOffline()} disabled={pending}>
          {pending ? <span className="spinner" aria-hidden="true" /> : null}
          {pending ? 'Opening…' : 'Work offline'}
        </button>
        {error && <Notice>{error}</Notice>}
      </div>

      <p className="auth-alt">
        When the connection comes back, sign in and this work comes with you — nothing is lost by starting here.
      </p>
    </AuthLayout>
  )
}
