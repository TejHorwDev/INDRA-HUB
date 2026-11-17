import { db } from './db'
import type { Business } from './types'

/** The two lines that go on every receipt. Kept in the database, not in code. */
export async function business(): Promise<Business> {
  const rows = await db.select<{ key: string; value: string }>('svc_settings', 'select=key,value')
  const map: Record<string, string> = {}
  for (const row of rows) map[row.key] = row.value
  return { name: map.business_name ?? '', contact: map.business_contact ?? '' }
}
