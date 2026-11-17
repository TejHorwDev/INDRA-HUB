/*
 * Money and dates, written the way they are said.
 *
 * Two currencies, chosen per payment: rupees for people down the road, dollars for people
 * who asked for a price in dollars. Nothing is converted — a payment is one currency, and
 * the totals keep them apart rather than inventing an exchange rate.
 */

export type Currency = 'NPR' | 'USD'

export function money(amount: number | string, currency: string): string {
  const value = typeof amount === 'string' ? Number(amount) : amount
  const c = currency === 'USD' ? 'USD' : 'NPR'
  return new Intl.NumberFormat(c === 'USD' ? 'en-US' : 'en-IN', {
    style: 'currency',
    currency: c,
    maximumFractionDigits: c === 'USD' ? 2 : 0
  }).format(Number.isFinite(value) ? value : 0)
}

/** 2026-11-13 → 13 Nov 2026. Dates are stored as dates, so they are read as dates. */
export function day(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  })
}

export function totals(payments: { amount: number | string; currency: string }[]) {
  const sum = { NPR: 0, USD: 0 }
  for (const payment of payments) {
    const amount = Number(payment.amount)
    if (!Number.isFinite(amount)) continue
    if (payment.currency === 'USD') sum.USD += amount
    else sum.NPR += amount
  }
  return sum
}

export function nextClientNo(existing: { client_no: string }[]): string {
  let highest = 0
  for (const row of existing) {
    const match = /^CL-(\d+)$/.exec(row.client_no)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `CL-${String(highest + 1).padStart(3, '0')}`
}
