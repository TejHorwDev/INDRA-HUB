import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertCircleIcon, CheckIcon, InfoIcon, XIcon } from './icons'

export type ToastVariant = 'success' | 'error' | 'info'

interface ToastRecord {
  id: number
  variant: ToastVariant
  message: string
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const TOAST_DURATION = 4200

const ToastContext = createContext<ToastApi | null>(null)

/**
 * Global toast stack. Screens call `const toast = useToast()` and then
 * `toast.success(...)`. Nothing triggers toasts yet — this is the foundation.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback((variant: ToastVariant, message: string) => {
    const id = nextId.current++
    setToasts((current) => [...current, { id, variant, message }])
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push('success', message),
      error: (message) => push('error', message),
      info: (message) => push('info', message)
    }),
    [push]
  )

  // Dev-only handle so the stack can be exercised before real triggers land.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as Window & { __toast?: ToastApi }).__toast = api
  }, [api])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function Toast({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), TOAST_DURATION)
    return () => window.clearTimeout(timer)
  }, [onDismiss, toast.id])

  const Icon =
    toast.variant === 'success' ? CheckIcon : toast.variant === 'error' ? AlertCircleIcon : InfoIcon

  return (
    <div
      className={`toast toast--${toast.variant}`}
      role={toast.variant === 'error' ? 'alert' : 'status'}
    >
      <span className={`toast-icon toast-icon--${toast.variant}`}>
        <Icon size={14} />
      </span>
      <span className="flex-1 text-[var(--ink)]">{toast.message}</span>
      <button
        type="button"
        className="icon-button -mt-1 -mr-1"
        style={{ width: 20, height: 20 }}
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        <XIcon size={12} />
      </button>
    </div>
  )
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside a ToastProvider')
  return context
}
