import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ConnectivityState } from '@shared/types'
import { api } from './api'

interface ConnectivityValue extends ConnectivityState {
  /** The routes that still make sense with no route out. */
  offline: boolean
  recheck: () => void
}

const ONLINE: ConnectivityState = { online: true, since: new Date().toISOString() }

const ConnectivityContext = createContext<ConnectivityValue>({
  ...ONLINE,
  offline: false,
  recheck: () => undefined
})

/**
 * Whether this machine has a way out.
 *
 * The main process owns the answer (`net.isOnline()`, polled cheaply and
 * re-read whenever the window is focused); this mirrors it into React. While
 * the first answer is in flight the app assumes it is online, because hiding
 * features for a moment is worse than showing one that turns out to need a
 * connection.
 *
 * The browser's own `online`/`offline` events are used as a second pair of
 * eyes: they fire immediately when Windows drops an adapter, which is sooner
 * than the next poll.
 */
export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnectivityState>(ONLINE)

  const recheck = useCallback(() => {
    void api.app
      .connectivity()
      .then((next) => setState(next))
      .catch(() => {
        // If the bridge cannot answer, believe the browser.
        setState({ online: navigator.onLine, since: new Date().toISOString() })
      })
  }, [])

  useEffect(() => {
    recheck()

    const off = api.app.onConnectivity((next) => setState(next))
    const onBrowserOnline = (): void => setState({ online: true, since: new Date().toISOString() })
    const onBrowserOffline = (): void =>
      setState({ online: false, since: new Date().toISOString() })

    window.addEventListener('online', onBrowserOnline)
    window.addEventListener('offline', onBrowserOffline)
    // Coming back to the window is a good moment to ask again.
    window.addEventListener('focus', recheck)

    return () => {
      off()
      window.removeEventListener('online', onBrowserOnline)
      window.removeEventListener('offline', onBrowserOffline)
      window.removeEventListener('focus', recheck)
    }
  }, [recheck])

  const value = useMemo<ConnectivityValue>(
    () => ({ ...state, offline: !state.online, recheck }),
    [state, recheck]
  )

  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>
}

export function useConnectivity(): ConnectivityValue {
  return useContext(ConnectivityContext)
}

/**
 * The routes that work with no connection.
 *
 * Writing and building a deck are the two things this app does entirely on the
 * machine, so they are what the offline workspace is built around. The
 * projects that hold them stay reachable too — that is where a copy is saved
 * and where a saved file is opened — and so does Settings, which is where the
 * account signs out and where updates are explained. Everything else (the
 * home screen, developers, credits, administration) waits for a connection.
 */
const OFFLINE_ROUTES = [
  '/documents',
  '/presentations',
  '/dashboard',
  '/settings',
  '/project',
  '/login',
  '/register'
]

export function routeAllowedOffline(pathname: string): boolean {
  return OFFLINE_ROUTES.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}
