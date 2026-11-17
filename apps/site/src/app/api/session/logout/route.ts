import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { COOKIE, deleteSession } from '@/lib/ledger/auth'

/** Sign out: the row goes first, so the cookie is worthless even if the browser keeps it. */
export async function POST(request: Request): Promise<NextResponse> {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value

  if (token) {
    try {
      await deleteSession(token)
    } catch {
      // A database that cannot be reached still deserves a sign-out on this device.
    }
  }

  const response = NextResponse.redirect(new URL('/login', request.url), 303)
  response.cookies.set(COOKIE, '', { ...{ path: '/' }, maxAge: 0 })
  return response
}
