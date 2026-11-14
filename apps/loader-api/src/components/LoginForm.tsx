'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/*
 * The sign-in form.
 *
 * It says the same thing for a wrong username and a wrong password, because the
 * server does. Rate limiting is the server's job; this only reports it.
 *
 * A wrong guess shakes the panel once, which is the only place in the product that
 * any motion is used to say "no" rather than "here".
 */
export default function LoginForm(): React.JSX.Element {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (busy) return
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
        setAttempt((count) => count + 1)
        return
      }

      router.replace('/admin/apps')
      router.refresh()
    } catch {
      setError('Could not reach the server.')
      setAttempt((count) => count + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} key={attempt} className={attempt ? 'shake' : undefined}>
      <div className="card">
        <div className="field">
          <label className="label" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            type="text"
            autoComplete="username"
            autoFocus
            placeholder="tej"
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
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {error ? <div className="notice error">{error}</div> : null}

        <button
          className="btn primary block"
          type="submit"
          disabled={busy || !username || !password}
          style={{ marginTop: 6 }}
        >
          {busy ? (
            <span className="working" aria-label="Signing in">
              <i />
              <i />
              <i />
            </span>
          ) : (
            'Sign in'
          )}
        </button>
      </div>
    </form>
  )
}
