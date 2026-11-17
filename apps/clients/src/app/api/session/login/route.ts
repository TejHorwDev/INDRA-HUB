import { NextResponse } from 'next/server'
import { COOKIE, COOKIE_OPTIONS, createSession, verifyPassword } from '@/lib/auth'
import { db, eq } from '@/lib/db'

/*
 * Sign in.
 *
 * Cookie and redirect on the same response, which is the whole reason this is a route handler
 * and not an action: a login that sets its cookie on one response and redirects on another is
 * a login that sometimes bounces.
 */

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData()
  const text = (name: string): string => {
    const value = form.get(name)
    return typeof value === 'string' ? value.trim() : ''
  }

  const back = (message: string): NextResponse =>
    NextResponse.redirect(new URL(`/login?e=${encodeURIComponent(message)}`, request.url), 303)

  try {
    const username = text('username').toLowerCase()
    const password = text('password')

    const users = await db.select<{ id: string; password_hash: string; role: string; status: string }>(
      'svc_users',
      `select=id,password_hash,role,status&username=eq.${eq(username)}`
    )

    const user = users[0]
    // One message for both failures: a login form is not a place to learn which usernames exist.
    if (!user || user.status !== 'active' || !verifyPassword(password, user.password_hash)) {
      return back('That username and password do not match.')
    }

    const token = await createSession(user.id)
    const response = NextResponse.redirect(new URL(user.role === 'owner' ? '/dashboard' : '/me', request.url), 303)
    response.cookies.set(COOKIE, token, COOKIE_OPTIONS)
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return back(message.slice(0, 240) || 'The database did not answer.')
  }
}
