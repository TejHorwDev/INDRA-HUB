/**
 * Client-side validation only — no backend is connected yet.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

export function validateEmail(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'Email is required.'
  if (!EMAIL_PATTERN.test(trimmed)) return 'Enter a valid email address, like you@company.com.'
  return null
}

export function validateRequired(value: string, label: string): string | null {
  return value.trim() ? null : `${label} is required.`
}

export function validateName(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'Name is required.'
  if (trimmed.length < 2) return 'Name must be at least 2 characters.'
  return null
}

export function validateLoginPassword(value: string): string | null {
  return value ? null : 'Password is required.'
}

export function validateNewPassword(value: string): string | null {
  if (!value) return 'Password is required.'
  if (value.length < 8) return 'Use at least 8 characters.'
  return null
}

export function validateConfirmation(password: string, confirmation: string): string | null {
  if (!confirmation) return 'Confirm your password.'
  if (password !== confirmation) return "Passwords don't match."
  return null
}

export type StrengthTone = 'danger' | 'warning' | 'success'

export interface PasswordStrength {
  /** 0–4, one point per satisfied requirement. */
  score: number
  label: string
  tone: StrengthTone
  missing: string[]
}

const REQUIREMENTS: Array<{ label: string; test: (value: string) => boolean }> = [
  { label: '8+ characters', test: (value) => value.length >= 8 },
  { label: 'a capital letter', test: (value) => /[A-Z]/.test(value) },
  { label: 'a number', test: (value) => /\d/.test(value) },
  { label: 'a symbol', test: (value) => /[^A-Za-z0-9]/.test(value) }
]

export function passwordStrength(password: string): PasswordStrength {
  const missing = REQUIREMENTS.filter((requirement) => !requirement.test(password)).map(
    (requirement) => requirement.label
  )
  const score = REQUIREMENTS.length - missing.length

  const label = score <= 1 ? 'Weak' : score === 2 ? 'Fair' : score === 3 ? 'Good' : 'Strong'
  const tone: StrengthTone = score <= 1 ? 'danger' : score === 2 ? 'warning' : 'success'

  return { score, label, tone, missing }
}
