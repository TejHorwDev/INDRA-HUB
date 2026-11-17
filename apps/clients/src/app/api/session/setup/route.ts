import { NextResponse } from 'next/server'
import { COOKIE, COOKIE_OPTIONS, createSession, hashPassword, needsOwner } from '@/lib/auth'
import { db } from '@/lib/db'

/*
 * First run: the person who deploys this owns it.
 *
 * A route handler rather than a server action because this response both sets a cookie and
 * redirects, and the browser has to receive the cookie on the redirect itself.
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
    if (!(await needsOwner())) return back('An owner already exists — sign in instead.')

    const username = text('username').toLowerCase()
    const password = text('password')
    const business = text('business')

    if (username.length < 3) return back('Pick a username of at least 3 characters.')
    if (password.length < 8) return back('Use a password of at least 8 characters.')

    const [user] = await db.insert<{ id: string; role: string }>('svc_users', {
      username,
      password_hash: hashPassword(password),
      role: 'owner'
    })

    if (!user) return back('The account was not created — the database returned nothing.')

    if (business) {
      await db.insert('svc_settings', { key: 'business_name', value: business })
    }

    const token = await createSession(user.id)
    const response = NextResponse.redirect(new URL('/dashboard', request.url), 303)
    response.cookies.set(COOKIE, token, COOKIE_OPTIONS)
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return back(message.slice(0, 240) || 'The account could not be created.')
  }
}
