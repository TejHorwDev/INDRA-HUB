import type { LoaderApp } from './types'

/*
 * Who may open what.
 *
 * Two independent locks, and deny wins:
 *
 *   1. The catalogue's own status. `locked` is the kill switch — a product pulled
 *      from sale, or under maintenance, or a build that is broken. It applies to
 *      everyone, including people who paid.
 *
 *   2. Entitlement. Whether this account owns the product, which INDRA Auth
 *      answers, never this app and never the database.
 *
 * A card is openable only when both say yes. Keeping the rule in one function
 * means there is one place to change when the entitlement source is wired in;
 * the dashboard, the detail panel and the action button all ask this.
 */

export function isAvailable(app: LoaderApp, owned: string[]): boolean {
  if (app.status !== 'active') return false
  // No product attached means nothing to gate: it is available to anyone signed
  // in, which is a legitimate way to publish a free tool.
  if (!app.keyauthAppId) return true
  return owned.includes(app.keyauthAppId)
}

/** The reason a card is closed, for the dialog to say out loud. */
export function lockedReason(app: LoaderApp, owned: string[]): 'unavailable' | 'unowned' | null {
  if (app.status !== 'active') return 'unavailable'
  if (!app.keyauthAppId) return null
  return owned.includes(app.keyauthAppId) ? null : 'unowned'
}
