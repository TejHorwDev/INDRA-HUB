'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/*
 * The sign-in form.
 *
 * It says the same thing for a wrong username and a wrong password, because the
 * server does. Rate limiting is the server's job; this only reports it.
 */
export default function LoginForm(): React.JSX.Element {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      const payload = (await response.json()) as { error?: string }

      if (!response.ok) {
        setError(payload.error ?? 'That did not work.')
        return
      }

      router.replace('/admin/apps')
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="field">
        <label className="label" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      {error ? <div className="notice error">{error}</div> : null}

      <button className="btn primary" type="submit" disabled={busy || !username || !password} style={{ width: '100%' }}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
