'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/*
 * Leaving.
 *
 * It spins for the length of the round trip because a button that does nothing visible
 * for four hundred milliseconds gets pressed twice.
 */
export default function SignOut(): React.JSX.Element {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  return (
    <button
      className="btn ghost small"
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await fetch('/api/admin/logout', { method: 'POST' })
        router.replace('/admin/login')
        router.refresh()
      }}
    >
      {busy ? (
        <span className="working" aria-label="Signing out">
          <i />
          <i />
          <i />
        </span>
      ) : (
        'Sign out'
      )}
    </button>
  )
}
