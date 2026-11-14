/*
 * Reading the list of products out of an answer whose shape nobody wrote down.
 *
 * `GET /v1/apps` on INDRA Auth returns the products attached to an account. Its
 * exact shape is not documented anywhere I can read, so this parses it
 * structurally: arrays of strings, arrays of objects, and the handful of wrappers
 * an endpoint like this tends to use. Both ids and names are collected, because
 * whether a catalogue row should carry the product's id or its name is a decision
 * nobody wrote down either.
 *
 * Kept free of imports so it can be tested as what it is — a function that reads
 * JSON — rather than through a network call.
 */

const ID_KEYS = [
  'id',
  'app_id',
  'appId',
  'appID',
  'appid',
  'product_id',
  'productId',
  'keyauth_app_id',
  'keyauthAppId'
]

const NAME_KEYS = ['name', 'app_name', 'appName', 'product_name', 'productName', 'title', 'slug']

const CONTAINERS = [
  'apps',
  'data',
  'items',
  'results',
  'result',
  'products',
  'owned',
  'app_ids',
  'appIds',
  'list',
  'entries',
  'subscriptions'
]

const normalise = (value: string): string => value.trim().toLowerCase()

function collect(value: unknown, out: Set<string>, depth: number): void {
  if (depth > 6 || value === null || value === undefined) return

  if (typeof value === 'string' || typeof value === 'number') {
    const text = normalise(String(value))
    if (text) out.add(text)
    return
  }

  if (Array.isArray(value)) {
    for (const entry of value) collect(entry, out, depth + 1)
    return
  }

  if (typeof value !== 'object') return

  const record = value as Record<string, unknown>
  let identified = false

  for (const key of ID_KEYS) {
    const raw = record[key]
    if (typeof raw === 'string' || typeof raw === 'number') {
      const text = normalise(String(raw))
      if (text) {
        out.add(text)
        identified = true
      }
    }
  }

  for (const key of NAME_KEYS) {
    const raw = record[key]
    if (typeof raw === 'string') {
      const text = normalise(raw)
      if (text) {
        out.add(text)
        identified = true
      }
    }
  }

  for (const key of CONTAINERS) {
    if (key in record) collect(record[key], out, depth + 1)
  }

  /*
   * Neither an identity nor a known wrapper: walk it anyway. A response shaped
   * `{success: true, payload: [...]}` is not in the list above and would otherwise
   * be invisible — which is exactly how a paying customer ends up locked out.
   */
  if (!identified) {
    for (const [key, entry] of Object.entries(record)) {
      if (CONTAINERS.includes(key)) continue
      if (typeof entry === 'object' && entry !== null) collect(entry, out, depth + 1)
    }
  }
}

/** Everything the answer says this account owns, lowercased and trimmed. */
export function parseOwned(payload: unknown): string[] {
  const out = new Set<string>()
  collect(payload, out, 0)
  return [...out]
}
