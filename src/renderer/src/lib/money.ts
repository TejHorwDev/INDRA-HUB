import type { CreditSettings } from '@shared/types'

/**
 * Money, as the server defines it.
 *
 * Every price in this app is an integer count of minor units — 399 is $3.99 —
 * and the currency, its symbol and how many decimals it uses are settings an
 * administrator owns, not constants in a component. So the rule lives here
 * once: a screen asks what to draw, it does not decide what a price means.
 *
 * The AI quotes no prices, so there is no conversion anywhere in this file. If
 * a workspace changes currency, prices are re-entered in that currency; old
 * receipts keep the currency they were quoted in and are formatted with it.
 */

/** What a currency looks like when the server has not said yet. */
export const FALLBACK_SETTINGS: Pick<CreditSettings, 'currency' | 'symbol' | 'decimals'> = {
  currency: 'USD',
  symbol: '$',
  decimals: 2
}

interface Shape {
  symbol: string
  decimals: number
  currency: string
}

function shapeOf(settings: Shape | null | undefined): Shape {
  if (!settings) return FALLBACK_SETTINGS
  return {
    symbol: settings.symbol || FALLBACK_SETTINGS.symbol,
    decimals: Number.isFinite(settings.decimals)
      ? Math.min(Math.max(Math.round(settings.decimals), 0), 3)
      : FALLBACK_SETTINGS.decimals,
    currency: settings.currency || FALLBACK_SETTINGS.currency
  }
}

const grouped = (value: string): string => value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/**
 * `399` → `$3.99`; `0` → `Free`.
 *
 * A zero price is a gift, and "$0.00" reads like a mistake, so it is spelled
 * out. Everything else is exact: the integer is split on the decimal point as
 * text rather than divided, so no float ever touches a price.
 */
export function money(minor: number | null | undefined, settings: Shape | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '—'
  if (minor === 0) return 'Free'
  const shape = shapeOf(settings)
  const sign = minor < 0 ? '−' : ''
  const value = Math.abs(Math.round(minor))
  if (shape.decimals === 0) return `${sign}${shape.symbol}${grouped(String(value))}`
  const scale = 10 ** shape.decimals
  const whole = Math.floor(value / scale)
  const fraction = String(value % scale).padStart(shape.decimals, '0')
  return `${sign}${shape.symbol}${grouped(String(whole))}.${fraction}`
}

/** The same amount, mid-sentence — `$3.99` becomes `3.99 US dollars` only when it helps. */
export function moneyLabel(minor: number | null | undefined, settings: Shape | null | undefined): string {
  const text = money(minor, settings)
  return text === 'Free' ? text : `${text} ${shapeOf(settings).currency}`
}

/**
 * What a person types — `3.99`, `3,99`, `₹ 3.99` — as minor units.
 *
 * Returns null when the text is not a price, so a form can refuse it instead of
 * silently turning a typo into zero. More decimals than the currency has are
 * refused rather than truncated: 3.999 pesos is not 3.99 pesos.
 */
export function minorFrom(text: string, decimals: number): number | null {
  /* A price is never negative, so a minus sign is refused rather than
     sign-flipped somewhere later where nobody would see it. */
  const clean = text.trim().replace(/[\s,'’]/g, '').replace(/[^\d.]/g, '')
  if (!clean || clean === '.') return null
  if (!/^\d*(\.\d*)?$/.test(clean)) return null
  const digits = Math.min(Math.max(Math.round(decimals), 0), 3)
  const [whole = '0', fraction = ''] = clean.split('.')
  if (fraction.length > digits) return null
  const scale = 10 ** digits
  const minor = Number(whole || '0') * scale + Number((fraction || '').padEnd(digits, '0') || '0')
  return Number.isFinite(minor) ? Math.round(minor) : null
}

/** Minor units back to the text an input shows: `399` → `3.99`. */
export function minorToText(minor: number, decimals: number): string {
  const digits = Math.min(Math.max(Math.round(decimals), 0), 3)
  if (!Number.isFinite(minor)) return ''
  const value = Math.round(minor)
  if (digits === 0) return String(value)
  const scale = 10 ** digits
  const whole = Math.floor(Math.abs(value) / scale)
  const fraction = String(Math.abs(value) % scale).padStart(digits, '0')
  return `${value < 0 ? '-' : ''}${whole}.${fraction}`
}

/** Credits are whole numbers; the server never sends fractions. */
export function credits(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return Math.round(value).toLocaleString()
}

/**
 * A receipt was quoted in a currency; it must keep saying that currency.
 *
 * Old rows predate the setting (they were priced in whole rupees), and a
 * workspace that switches from dollars to rupees must not make yesterday's
 * receipt read as today's money. So a receipt is formatted with the symbols and
 * decimals of the currency written on it, and the workspace's own settings are
 * used only when the two agree.
 */
const KNOWN: Record<string, { symbol: string; decimals: number }> = {
  USD: { symbol: '$', decimals: 2 },
  EUR: { symbol: '€', decimals: 2 },
  GBP: { symbol: '£', decimals: 2 },
  INR: { symbol: '₹', decimals: 0 },
  NPR: { symbol: 'Rs', decimals: 2 },
  AUD: { symbol: 'A$', decimals: 2 },
  CAD: { symbol: 'C$', decimals: 2 },
  JPY: { symbol: '¥', decimals: 0 },
  AED: { symbol: 'AED', decimals: 2 },
  SGD: { symbol: 'S$', decimals: 2 },
  BDT: { symbol: '৳', decimals: 2 },
  PKR: { symbol: 'Rs', decimals: 2 },
  LKR: { symbol: 'Rs', decimals: 2 }
}

export function shapeFor(
  currency: string | null | undefined,
  settings: Pick<CreditSettings, 'currency' | 'symbol' | 'decimals'> | null | undefined
): Shape {
  const code = (currency ?? '').toUpperCase()
  if (!code) return shapeOf(settings)
  if (settings && code === (settings.currency ?? '').toUpperCase()) return shapeOf(settings)
  const known = KNOWN[code]
  return known
    ? { ...known, currency: code }
    : { symbol: `${code} `, decimals: 2, currency: code }
}
