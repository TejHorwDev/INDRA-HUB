'use client'

import { useRouter } from 'next/navigation'

export default function SignOut(): React.JSX.Element {
  const router = useRouter()

  return (
    <button
      className="btn ghost small"
      type="button"
      onClick={async () => {
        await fetch('/api/admin/logout', { method: 'POST' })
        router.replace('/admin/login')
        router.refresh()
      }}
    >
      Sign out
    </button>
  )
}
