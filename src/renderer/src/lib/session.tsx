import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { LoginInput, RegisterInput, SessionUser } from '@shared/types'
import { api } from './api'

interface SessionValue {
  user: SessionUser | null
  /** True until the main process answers whether a session exists. */
  loading: boolean
  signIn: (input: LoginInput) => Promise<SessionUser>
  signUp: (input: RegisterInput) => Promise<SessionUser>
  signOut: () => Promise<void>
  /** Re-reads the main process session, e.g. after a profile change. */
  refresh: () => Promise<SessionUser | null>
}

const SessionContext = createContext<SessionValue | null>(null)

/**
 * The main process owns the session; this mirrors it for rendering and is
 * never the source of truth for authorization.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    api.auth
      .current()
      .then((current) => {
        if (active) setUser(current)
      })
      .catch(() => {
        if (active) setUser(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const signIn = useCallback(async (input: LoginInput) => {
    const signedIn = await api.auth.signIn(input)
    setUser(signedIn)
    return signedIn
  }, [])

  const signUp = useCallback(async (input: RegisterInput) => {
    const created = await api.auth.signUp(input)
    setUser(created)
    return created
  }, [])

  const refresh = useCallback(async () => {
    try {
      const current = await api.auth.current()
      setUser(current)
      return current
    } catch {
      return null
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await api.auth.signOut()
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo<SessionValue>(
    () => ({ user, loading, signIn, signUp, signOut, refresh }),
    [loading, refresh, signIn, signOut, signUp, user]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession must be used inside a SessionProvider')
  return context
}
