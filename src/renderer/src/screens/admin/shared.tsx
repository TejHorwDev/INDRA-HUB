import { useState } from 'react'
import type { ReactNode } from 'react'
import type { AdminAuditAction, AdminOverview } from '@shared/types'
import { SearchIcon } from '../../components/icons'
import { errorMessage } from '../../lib/api'
import { useToast } from '../../components/ToastProvider'

export interface SectionProps {
  overview: AdminOverview
  refresh: () => Promise<void>
}

export type AdminSectionId =
  | 'overview'
  | 'accounts'
  | 'projects'
  | 'content'
  | 'keys'
  | 'access'
  | 'backend'
  | 'activity'
  | 'system'

const dateFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric'
})

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

export function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateFormat.format(date)
}

export function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormat.format(date)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

export const AUDIT_LABELS: Record<AdminAuditAction, string> = {
  setup: 'Administrator created',
  sign_in: 'Signed in',
  sign_out: 'Signed out',
  sign_in_failed: 'Failed sign-in',
  password_changed: 'Admin password changed',
  identity_changed: 'Admin identity changed',
  account_suspended: 'Account suspended',
  account_restored: 'Account restored',
  account_deleted: 'Account deleted',
  password_reset: 'Password reset',
  account_signed_out: 'Session ended',
  sessions_cleared: 'All sessions ended',
  project_renamed: 'Project renamed',
  project_transferred: 'Project transferred',
  project_deleted: 'Project deleted',
  document_deleted: 'Document deleted',
  presentation_deleted: 'Presentation deleted',
  settings_updated: 'Settings updated',
  keys_created: 'Activation keys created',
  key_revoked: 'Activation key revoked',
  key_deleted: 'Activation key deleted'
}

/**
 * Runs one admin mutation, reports it, and reloads the overview so the panel
 * never shows optimistically edited numbers.
 */
export function useAdminAction(refresh: () => Promise<void>) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  async function run(key: string, action: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(key)
    try {
      await action()
      toast.success(success)
      await refresh()
      return true
    } catch (error) {
      toast.error(errorMessage(error))
      return false
    } finally {
      setBusy(null)
    }
  }

  return { busy, run }
}

export function Badge({
  tone = 'neutral',
  children
}: {
  tone?: 'neutral' | 'good' | 'warn' | 'accent'
  children: string | number
}) {
  return <span className={`admin-badge admin-badge--${tone}`}>{children}</span>
}

export function SearchField({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <label className="admin-search">
      <SearchIcon size={13} className="admin-search-icon" />
      <input
        type="search"
        className="admin-search-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        spellCheck={false}
      />
    </label>
  )
}

export function SectionHead({
  title,
  description,
  children
}: {
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="admin-section-head">
      <div>
        <h1 className="admin-title">{title}</h1>
        <p className="admin-subtitle">{description}</p>
      </div>
      {children && <div className="admin-section-tools">{children}</div>}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  description: string
  disabled?: boolean
}) {
  return (
    <div className="admin-toggle-row">
      <div className="admin-toggle-text">
        <p className="admin-toggle-label">{label}</p>
        <p className="admin-toggle-description">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`admin-toggle${checked ? ' admin-toggle--on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="admin-toggle-knob" aria-hidden="true" />
      </button>
    </div>
  )
}
