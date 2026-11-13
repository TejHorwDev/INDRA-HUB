import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ThemeMode } from '@shared/types'

const STORAGE_KEY = 'indra-hub.theme'

function readStoredTheme(): ThemeMode | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : null
  } catch {
    return null
  }
}

let shiftTimer: number | undefined

/**
 * Applies the theme. When `animate` is set the colours cross-fade for a quarter
 * of a second instead of cutting — the class is removed again straight after,
 * so nothing carries the cost of a global transition in normal use.
 */
function applyTheme(theme: ThemeMode, animate = false): void {
  const root = document.documentElement
  if (animate) {
    root.classList.add('theme-shifting')
    window.clearTimeout(shiftTimer)
    shiftTimer = window.setTimeout(() => root.classList.remove('theme-shifting'), 260)
  }
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

/**
 * Matte black is the theme this product is designed in, so it is the one a
 * fresh install opens in. The light theme is a deliberate choice, not a
 * consequence of how the operating system happens to be configured — the
 * workspace looks the same on every machine in the office.
 */
const DEFAULT_THEME: ThemeMode = 'dark'

/** Runs before the first render so the shell never flashes the wrong theme. */
export function initTheme(): void {
  applyTheme(readStoredTheme() ?? DEFAULT_THEME)
}

interface ThemeContextValue {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Start from the saved choice so the first effect never overrides it.
  const [theme, setThemeState] = useState<ThemeMode>(() => readStoredTheme() ?? DEFAULT_THEME)

  const applied = useRef<ThemeMode | null>(null)

  useEffect(() => {
    applyTheme(theme, applied.current !== null)
    applied.current = theme
  }, [theme])

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
