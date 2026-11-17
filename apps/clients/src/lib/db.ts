/*
 * The database, through PostgREST.
 *
 * No client library: every call this app makes is a plain request to Supabase's REST
 * endpoint with the service key on the server. The key never reaches the browser — every
 * export here is only ever imported from a server component or a server action.
 *
 * Tables are RLS-enabled with no policies, so the anon key sees nothing. The service key is
 * the only thing that can read them, and it exists only in this process.
 */

import { env } from './env'

export class DbError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.serviceKey,
      authorization: `Bearer ${env.serviceKey}`,
      'content-type': 'application/json',
      ...(init.headers ?? {})
    },
    cache: 'no-store'
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new DbError(detail.slice(0, 300) || `Database answered ${response.status}`, response.status)
  }

  if (response.status === 204) return undefined as T
  const body = await response.text()
  return (body ? JSON.parse(body) : undefined) as T
}

export const db = {
  select<T>(table: string, query = 'select=*'): Promise<T[]> {
    return rest<T[]>(`${table}?${query}`)
  },

  insert<T>(table: string, row: Record<string, unknown>): Promise<T[]> {
    return rest<T[]>(table, {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify(row)
    })
  },

  update<T>(table: string, filter: string, patch: Record<string, unknown>): Promise<T[]> {
    return rest<T[]>(`${table}?${filter}`, {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify(patch)
    })
  },

  remove(table: string, filter: string): Promise<void> {
    return rest<void>(`${table}?${filter}`, { method: 'DELETE' })
  }
}

/** PostgREST wants values URL-escaped; ids and slugs are the only things we filter by. */
export function eq(value: string): string {
  return encodeURIComponent(value)
}
