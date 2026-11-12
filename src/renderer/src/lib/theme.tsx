import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ThemeMode } from '@shared/types'

const STORAGE_KEY = 'indra-hub.theme'

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function readStoredTheme(): ThemeMode | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : null
  } catch {
    return null
  }
}

function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

/** Runs before the first render so the shell never flashes the wrong theme. */
export function initTheme(): void {
  applyTheme(readStoredTheme() ?? (prefersDark() ? 'dark' : 'light'))
}

interface ThemeContextValue {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Start from the saved choice so the first effect never overrides it.
  const [theme, setThemeState] = useState<ThemeMode>(
    () => readStoredTheme() ?? (prefersDark() ? 'dark' : 'light')
  )

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // Follow the OS until the user makes an explicit choice.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (event: MediaQueryListEvent): void => {
      if (!readStoredTheme()) setThemeState(event.matches ? 'dark' : 'light')
    }
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage can be unavailable; the choice still applies for this session.
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [setTheme, theme])

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider')
  return context
}
