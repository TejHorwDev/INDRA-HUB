import { NextResponse } from 'next/server'
import { adminReady } from '@/lib/env'
import {
  SESSION_COOKIE,
  checkCredentials,
  cookieOptions,
  issueSession,
  noteSuccess,
  tooManyAttempts
} from '@/lib/auth'
import { body, fail, serverError, text } from '@/lib/http'

/*
 * POST /api/admin/login
 *
 * A wrong username and a wrong password answer identically, and both cost the same
 * time. Ten tries per quarter hour per address.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!adminReady()) {
    return fail(
      'The panel is not configured yet. Set ADMIN_USERNAME, ADMIN_PASSWORD and ADMIN_SESSION_SECRET.',
      503
    )
  }

  const address =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'

  if (tooManyAttempts(address)) return fail('Too many attempts. Try again in a few minutes.', 429)

  const payload = await body<{ username?: unknown; password?: unknown }>(request)
  const username = text(payload?.username, 120)
  const password = text(payload?.password, 200)

  if (!username || !password) return fail('Enter a username and a password.')

  try {
    if (!checkCredentials(username, password)) return fail('That username and password do not match.', 401)

    noteSuccess(address)
    const token = await issueSession()
    const response = NextResponse.json({ ok: true })
    response.cookies.set(SESSION_COOKIE, token, cookieOptions())
    return response
  } catch (error) {
    return serverError('admin/login', error)
  }
}
