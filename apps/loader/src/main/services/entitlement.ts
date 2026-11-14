import type { EntitlementReport } from '@shared/types'
import { authBase, sessionToken } from './auth'
import { parseOwned } from '../lib/owned'

/*
 * What this account owns.
 *
 * INDRA Auth is the only authority here — the loader never decides entitlement
 * from the catalogue, a licence string or anything cached on disk.
 *
 * `GET /v1/apps` answers with the products attached to the signed-in account. The
 * response shape is not documented anywhere I can read, so this parses it
 * structurally instead of assuming one: arrays of strings, arrays of objects, and
 * the handful of object wrappers an API of this kind tends to use. Both ids and
 * names are collected, because whether a catalogue row should carry the product's
 * id or its name is a decision nobody has written down either.
 *
 * The cost of being tolerant here is a few lines. The cost of being wrong is every
 * customer seeing "locked" on something they paid for, which is what happened.
 */

const TIMEOUT_MS = 12_000

/** The last lookup, kept for the diagnostics button and the log. */
let lastError: string | null = null
let lastCount = 0

/** The call, with everything it learned, for the diagnostics button. */
export async function entitlementReport(): Promise<EntitlementReport> {
  const token = sessionToken()
  if (!token) {
    lastError = 'Not signed in.'
    lastCount = 0
    return { ok: false, status: 0, count: 0, ids: [], error: lastError }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(`${authBase()}/v1/apps`, {
      signal: controller.signal,
      /*
       * The bearer header is the convention; the second is the other convention this
       * kind of service uses. Sending both costs nothing and removes a round trip
       * spent discovering which one INDRA Auth wants — 401 with a single header
       * tells you nothing about the answer behind it.
       */
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'x-session-token': token
      },
      cache: 'no-store'
    })

    if (!response.ok) {
      lastError = `INDRA Auth answered ${response.status}.`
      lastCount = 0
      return { ok: false, status: response.status, count: 0, ids: [], error: lastError }
    }

    const ids = parseOwned(await response.json())

    lastError = null
    lastCount = ids.length
    return { ok: true, status: response.status, count: ids.length, ids, error: null }
  } catch (error) {
    lastError =
      error instanceof Error && error.name === 'AbortError'
        ? 'INDRA Auth did not answer in time.'
        : 'Could not reach INDRA Auth.'
    lastCount = 0
    return { ok: false, status: 0, count: 0, ids: [], error: lastError }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The ids and names this account owns.
 *
 * A failed lookup returns nothing owned, which locks every gated product. That is
 * the safe direction: a paying customer sees "locked" and tells you, where the
 * other direction shows your catalogue to a stranger.
 */
export async function ownedProductIds(): Promise<string[]> {
  const report = await entitlementReport()
  if (report.error) console.warn('[entitlement]', report.error)
  return report.ids
}

export function entitlementError(): string | null {
  return lastError
}

export function entitlementCount(): number {
  return lastCount
}
