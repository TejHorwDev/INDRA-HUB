import { db } from './db'
import type { Business } from './types'

export interface Brand extends Business {
  /** Where an enquiry should go: a Discord invite if there is one, otherwise the contact line. */
  discord: string
}

/** The lines that go on every receipt, and where people should reach out. */
export async function business(): Promise<Brand> {
  const rows = await db.select<{ key: string; value: string }>('svc_settings', 'select=key,value')
  const map: Record<string, string> = {}
  for (const row of rows) map[row.key] = row.value
  return {
    name: map.business_name ?? '',
    contact: map.business_contact ?? '',
    discord: map.discord_url ?? ''
  }
}

/**
 * The one button every page offers.
 *
 * A shop that is not selling sends people somewhere a conversation can start. Discord when it
 * has been set, the contact line when it has not, and a plain "get in touch" when neither
 * exists yet — never a dead download for something that is not being downloaded.
 */
export function contactLink(brand: Brand): { href: string; label: string } {
  if (brand.discord) return { href: brand.discord, label: 'Talk on Discord' }
  const address = brand.contact.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0]
  if (address) return { href: `mailto:${address}`, label: 'Ask about this' }
  return { href: '/#contact', label: 'Get in touch' }
}
