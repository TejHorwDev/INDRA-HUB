import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppPublicStatus } from '@shared/types'
import { api } from './api'

const FALLBACK: AppPublicStatus = {
  maintenanceMode: false,
  maintenanceMessage: '',
  allowRegistration: true,
  requireActivationKey: false,
  adminConfigured: false
}

interface AppStatusValue {
  status: AppPublicStatus
  refresh: () => Promise<void>
}

const AppStatusContext = createContext<AppStatusValue | null>(null)

/**
 * The main process owns these switches. This provider only mirrors them so the
 * UI can render maintenance and closed sign-ups; every call is enforced again
 * server-side, so a stale mirror never grants access.
 */
export function AppStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppPublicStatus>(FALLBACK)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.app.status())
    } catch {
      // Keep the last known state; the IPC guard still decides what is allowed.
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15_000)
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const value = useMemo<AppStatusValue>(() => ({ status, refresh }), [status, refresh])

  return <AppStatusContext.Provider value={value}>{children}</AppStatusContext.Provider>
}

export function useAppStatus(): AppStatusValue {
  const context = useContext(AppStatusContext)
  if (!context) throw new Error('useAppStatus must be used inside an AppStatusProvider')
  return context
}
