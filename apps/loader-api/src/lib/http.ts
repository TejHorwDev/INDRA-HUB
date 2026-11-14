import { NextResponse } from 'next/server'

/*
 * JSON responses, with one rule: no error leaves the server with a stack trace in
 * it. The message is for the person using the panel; the detail is for the log.
 */

export function ok<T>(body: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: { 'cache-control': 'no-store', ...(init?.headers ?? {}) }
  })
}

export function fail(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } })
}

export function serverError(where: string, error: unknown): NextResponse {
  console.error(`[${where}]`, error instanceof Error ? error.stack ?? error.message : error)
  return fail('Something went wrong on the server. The log has the detail.', 500)
}

/** A JSON body, or `null`. Never throws on malformed input. */
export async function body<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

export function text(value: unknown, max = 4000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}
