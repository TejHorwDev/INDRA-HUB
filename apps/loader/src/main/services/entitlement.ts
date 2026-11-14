/*
 * What this account owns.
 *
 * INDRA Auth is the only authority here — the loader never decides entitlement
 * from the catalogue, a licence string or anything cached on disk.
 *
 * The call this needs is `GET /v1/apps`, which returns the products attached to
 * the signed-in account. Until its response shape is confirmed against a real
 * signed-in user, this returns an empty set: nothing is owned, so anything with a
 * product id attached shows as locked. That is the safe direction to be wrong in
 * — a paid user sees "locked" and messages you, rather than a stranger seeing
 * "available".
 */
export async function ownedProductIds(): Promise<string[]> {
  return []
}
