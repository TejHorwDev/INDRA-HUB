import type { SessionUser } from '@shared/types'
import { publishPortrait, portraitOnServer } from './cloud'
import { readPortraitFile } from './portrait'
import { findUserById } from './users'

/*
 * Making sure a picture that exists here also exists on the server.
 *
 * Uploading a portrait was a fire-and-forget call next to the save: if it failed
 * — no connection for a second, a token that expired mid-request, a policy not
 * yet applied — nothing noticed and nothing retried. The file stayed on the PC
 * that took it, and the account looked like it had a picture until another
 * machine showed initials.
 *
 * This is the repair pass. It is cheap (one row read, one HEAD-shaped request),
 * it is idempotent, and it is safe to run on every sign-in: if the server
 * already holds the same portrait, it does nothing at all.
 */

export type MediaState = 'none' | 'local-only' | 'on-server'

export interface PortraitRepair {
  state: MediaState
  path: string | null
}

const RETRY_AFTER_MS = 60_000
let lastAttempt = 0
let lastState: MediaState = 'none'

export function lastPortraitState(): MediaState {
  return lastState
}

/**
 * Publishes the signed-in account's picture if the server does not have it.
 * Never throws: a picture is not worth failing a sign-in over, and the next
 * attempt is a minute away at worst.
 */
export async function repairPortrait(viewer: SessionUser, force = false): Promise<PortraitRepair> {
  try {
    const user = findUserById(viewer.id)
    const value = String(user?.avatar ?? '')
    if (!value.startsWith('photo:')) {
      lastState = 'none'
      return { state: 'none', path: null }
    }

    const id = value.slice('photo:'.length)
    const current = await portraitOnServer(viewer)
    if (current.path && current.path.includes(`/${id}.`)) {
      lastState = 'on-server'
      return { state: 'on-server', path: current.path }
    }

    if (!force && Date.now() - lastAttempt < RETRY_AFTER_MS) {
      lastState = 'local-only'
      return { state: 'local-only', path: current.path }
    }
    lastAttempt = Date.now()

    const file = readPortraitFile(id)
    if (!file) {
      lastState = 'none'
      return { state: 'none', path: current.path }
    }

    const published = await publishPortrait(viewer, id, file.bytes, file.mime)
    if (!published) {
      lastState = 'local-only'
      return { state: 'local-only', path: current.path }
    }

    /* Confirm rather than assume: the row is what other machines read. */
    const after = await portraitOnServer(viewer)
    const ok = Boolean(after.path)
    lastState = ok ? 'on-server' : 'local-only'
    return { state: lastState, path: after.path }
  } catch {
    lastState = 'local-only'
    return { state: 'local-only', path: null }
  }
}
