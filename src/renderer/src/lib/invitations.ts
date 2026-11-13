import { useSyncExternalStore } from 'react'
import type { InvitationAnswer, InvitationSummary } from '@shared/types'
import { api } from './api'

/*
 * The invitations waiting for this account, kept in one place.
 *
 * Three surfaces need the same list — the Home section that answers them, the
 * rail badge that says one has arrived, and the toast that names the sender.
 * Fetching separately in each would let them disagree, so there is one snapshot
 * here and everyone subscribes to it.
 *
 * Nothing in this module decides anything: the main process says who may invite
 * and who may answer. This only keeps the renderer's copy current.
 */

let snapshot: InvitationSummary[] = []
const listeners = new Set<() => void>()

function publish(next: InvitationSummary[]): void {
  snapshot = next
  for (const listener of listeners) listener()
}

/**
 * The poll runs every 30 seconds; most of the time nothing has changed. An
 * unchanged read must not republish, or every screen that subscribes redraws
 * for no reason and entrance animations restart.
 */
function unchanged(next: InvitationSummary[]): boolean {
  if (next.length !== snapshot.length) return false
  return next.every((entry, index) => {
    const current = snapshot[index]
    return (
      entry.id === current.id &&
      entry.targetName === current.targetName &&
      entry.displayName === current.displayName
    )
  })
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getInvitations(): InvitationSummary[] {
  return snapshot
}

/** Re-reads the list; a failed read shows nothing rather than a stale count. */
export async function refreshInvitations(): Promise<InvitationSummary[]> {
  try {
    const next = await api.invitations.list()
    if (!unchanged(next)) publish(next)
  } catch {
    if (snapshot.length > 0) publish([])
  }
  return snapshot
}

/** Signing out must not leave one person's invitations on another's screen. */
export function clearInvitations(): void {
  if (snapshot.length > 0) publish([])
}

export async function acceptInvitation(invitationId: string): Promise<InvitationAnswer> {
  const answer = await api.invitations.accept(invitationId)
  await refreshInvitations()
  return answer
}

export async function declineInvitation(invitationId: string): Promise<InvitationAnswer> {
  const answer = await api.invitations.decline(invitationId)
  await refreshInvitations()
  return answer
}

/** The owner withdrawing a question nobody answered. */
export async function cancelInvitation(invitationId: string): Promise<void> {
  await api.invitations.cancel(invitationId)
  await refreshInvitations()
}

export function useInvitations(): InvitationSummary[] {
  return useSyncExternalStore(subscribe, getInvitations, getInvitations)
}
