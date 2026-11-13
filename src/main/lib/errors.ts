import type { ApiResult, ErrorCode } from '@shared/types'

/** An expected, user-facing failure. Anything else becomes UNKNOWN. */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly field?: string

  constructor(code: ErrorCode, message: string, field?: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.field = field
  }
}

export const errors = {
  authRequired: () => new AppError('AUTH_REQUIRED', 'Sign in to continue.'),
  invalidCredentials: () =>
    new AppError('INVALID_CREDENTIALS', 'That username or password is incorrect.'),
  validation: (message: string, field?: string) => new AppError('VALIDATION', message, field),
  conflict: (message: string, field?: string) => new AppError('CONFLICT', message, field),
  notFound: (message = 'Project not found.') => new AppError('NOT_FOUND', message),
  forbidden: (message = 'Only the head developer can do that.') =>
    new AppError('FORBIDDEN', message),
  duplicateMember: () => new AppError('DUPLICATE_MEMBER', 'That person is already on the team.'),
  adminRequired: () => new AppError('ADMIN_REQUIRED', 'Administrator sign-in required.'),
  adminInvalidCredentials: () =>
    new AppError('INVALID_CREDENTIALS', 'That administrator email or password is incorrect.'),
  throttled: (message: string) => new AppError('THROTTLED', message),
  accountSuspended: () =>
    new AppError('ACCOUNT_SUSPENDED', 'This account has been suspended by the administrator.'),
  maintenance: () =>
    new AppError('MAINTENANCE', 'INDRA HUB is in maintenance mode. Try again shortly.'),
  registrationClosed: () =>
    new AppError('REGISTRATION_CLOSED', 'New account creation is currently closed.'),
  insufficientCredits: (message: string) =>
    new AppError('INSUFFICIENT_CREDITS', message),
  aiUnavailable: (message: string) => new AppError('AI_UNAVAILABLE', message),
  cloud: (message: string) => new AppError('UNKNOWN', message),
  offline: (message: string) => new AppError('UNKNOWN', message)
}

/**
 * Wraps a handler so every failure reaches the renderer as a typed result
 * instead of a serialized Error. Internal messages are never leaked.
 */
export async function toResult<T>(run: () => T | Promise<T>): Promise<ApiResult<T>> {
  try {
    return { ok: true, data: await run() }
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, code: error.code, message: error.message, field: error.field }
    }
    console.error('[ipc] unhandled failure', error)
    return { ok: false, code: 'UNKNOWN', message: 'Something went wrong. Please try again.' }
  }
}
