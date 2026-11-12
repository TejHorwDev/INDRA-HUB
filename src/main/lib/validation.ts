import type { RegisterInput } from '@shared/types'
import { errors } from './errors'

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,23}$/
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase()
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Server-side validation. The renderer validates too, for fast feedback, but
 * nothing here trusts that it happened.
 */
export function validateRegistration(input: RegisterInput): {
  username: string
  displayName: string
  email: string
} {
  const username = normalizeUsername(input.username ?? '')
  const displayName = (input.displayName ?? '').trim()
  const email = normalizeEmail(input.email ?? '')
  const password = input.password ?? ''

  if (!USERNAME_PATTERN.test(username)) {
    throw errors.validation(
      'Use 3–24 characters: letters, numbers, hyphen or underscore.',
      'username'
    )
  }
  if (displayName.length < 2 || displayName.length > 48) {
    throw errors.validation('Name must be 2–48 characters.', 'displayName')
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw errors.validation('Enter a valid email address.', 'email')
  }
  if (password.length < 8 || password.length > 200) {
    throw errors.validation('Use at least 8 characters.', 'password')
  }

  return { username, displayName, email }
}

export function validateProjectInput(input: { name?: string; description?: string }): {
  name: string
  description: string
} {
  const name = (input.name ?? '').trim().replace(/\s+/g, ' ')
  const description = (input.description ?? '').trim()

  if (name.length < 1) throw errors.validation('Give the project a name.', 'name')
  if (name.length > 80) throw errors.validation('Keep the name under 80 characters.', 'name')
  if (description.length > 280) {
    throw errors.validation('Keep the description under 280 characters.', 'description')
  }

  return { name, description }
}

export function validateSearchQuery(value: unknown): string {
  const query = typeof value === 'string' ? value.trim() : ''
  if (query.length < 2) throw errors.validation('Type at least two characters to search.')
  return query.slice(0, 48)
}
