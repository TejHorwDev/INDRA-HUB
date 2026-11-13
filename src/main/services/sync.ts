import { BrowserWindow, net } from 'electron'

import { getDatabase } from '../db/database'
import { accountState } from '../lib/accountSession'
import type { CloudProjectSummary, SessionUser } from '@shared/types'
import { currentUser } from './auth'
import { listCloudProjects, pullProject, pushProject } from './cloud'

/*
 * Automatic saving.
 *
 * The manual "save to cloud" button was a promise the app could not keep: the
 * work was on one PC until somebody remembered to press it. This is the part
 * that makes the promise true — after an edit, the project goes up on its own,
 * and after a sign-in the projects this PC has never seen come down.
 *
 * What it deliberately does not do:
 *
 *   • It never pulls over a project that already exists here. Two copies of the
 *     same project on one PC is a worse failure than a missing one, and merging
 *     is a different job (per-document revisions, tombstones).
 *   • It does not run for the anonymous device identity. Only a connected INDRA
 *     account syncs, because only then is there somebody to sync as — and
 *     nobody's existing installation starts behaving differently until they
 *     sign in.
 *   • It does not retry a refusal forever. A shared project the server will not
 *     accept is dropped from the queue with the reason kept, rather than
 *     turning into a loop that hammers the network.
 *
 * The conflict story is honest and limited: last writer wins per project, and
 * the server already refuses a replace while another PC's member is attached.
 * Two PCs editing the same project at the same time is step 4's problem.
 */

const DEBOUNCE_MS = 2500
const RETRY_MS = 15_000

const pending = new Set<string>()
let timer: NodeJS.Timeout | null = null
let flushing = false
let lastSyncedAt: string | null = null
let lastError: string | null = null
let started = false

export interface SyncState {
  connected: boolean
  pending: number
  syncing: boolean
  lastSyncedAt: string | null
  error: string | null
}

/** Signed in to an INDRA account — the only thing that makes a PC syncable. */
function connected(): boolean {
  return Boolean(accountState()?.connected)
}

/**
 * Signed in *and* the machine believes it has a network. Only the upload needs
 * this: an edit made offline is still queued, so nothing is lost while the
 * connection is down.
 */
function enabled(): boolean {
  if (!connected()) return false
  try {
    return net.isOnline()
  } catch {
    return true
  }
}

function schedule(delay = DEBOUNCE_MS): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void flush()
  }, delay)
}

/**
 * "This project changed." Called by the editors after a commit, never during
 * one: the push reads the database, so it must see finished writes.
 */
export function markDirty(projectId: string | null | undefined): void {
  if (typeof projectId !== 'string' || projectId.length === 0) return
  if (!connected()) return
  pending.add(projectId)
  schedule()
}

/** Something the user did changed which projects exist; re-read the cloud. */
export function markEverythingDirty(): void {
  const rows = getDatabase().prepare('SELECT id FROM projects').all() as Array<{ id: string }>
  for (const row of rows) pending.add(row.id)
  if (pending.size > 0) schedule(200)
}

function dropFromQueue(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'VALIDATION' || code === 'FORBIDDEN' || code === 'NOT_FOUND'
}

async function flush(): Promise<void> {
  if (flushing) return
  if (!enabled() || pending.size === 0) return
  const user: SessionUser | null = currentUser()
  if (!user) return

  flushing = true
  try {
    for (const projectId of [...pending]) {
      pending.delete(projectId)
      try {
        await pushProject(user, projectId)
        lastSyncedAt = new Date().toISOString()
        lastError = null
      } catch (error) {
        if (dropFromQueue(error)) {
          lastError = (error as Error).message
          continue
        }
        // Offline or the server hesitated: keep it and try again later.
        pending.add(projectId)
        lastError = (error as Error).message
        break
      }
    }
  } finally {
    flushing = false
    /* Offline work stays queued and keeps trying; an idle timer costs nothing. */
    if (pending.size > 0) schedule(RETRY_MS)
  }
}

/** The "Save now" button, and the moment just before the window closes. */
export async function syncNow(): Promise<SyncState> {
  markEverythingDirty()
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  await flush()
  return syncState()
}

export function syncState(): SyncState {
  return {
    connected: connected(),
    pending: pending.size,
    syncing: flushing,
    lastSyncedAt,
    error: lastError
  }
}

/* ------------------------------------------------------------------ */
/* Pulling                                                            */
/* ------------------------------------------------------------------ */

/**
 * Projects in the cloud that this PC does not have.
 *
 * The mapping table is the truth for "does this PC have it": a pushed project
 * remembers its cloud id, and a pulled project remembers the one it came from.
 * Comparing names would be wrong the first time two projects share one.
 */
function projectsToPull(remote: CloudProjectSummary[]): string[] {
  const db = getDatabase()
  const known = new Set(
    (db.prepare('SELECT cloud_project_id FROM cloud_saves').all() as Array<{
      cloud_project_id: string
    }>).map((row) => row.cloud_project_id)
  )
  const local = new Set(
    (db.prepare('SELECT id FROM projects').all() as Array<{ id: string }>).map((row) => row.id)
  )
  return remote
    .filter((project) => !known.has(project.cloudId) && !local.has(project.cloudId))
    .map((project) => project.cloudId)
}

async function pullMissing(): Promise<number> {
  if (!enabled()) return 0
  const user = currentUser()
  if (!user) return 0

  let remote: CloudProjectSummary[] = []
  try {
    remote = await listCloudProjects(user)
  } catch (error) {
    lastError = (error as Error).message
    return 0
  }

  let pulled = 0
  for (const cloudId of projectsToPull(remote)) {
    try {
      await pullProject(user, cloudId)
      pulled += 1
    } catch (error) {
      lastError = (error as Error).message
    }
  }

  if (pulled > 0) {
    lastSyncedAt = new Date().toISOString()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('projects:changed')
    }
  }
  return pulled
}

/**
 * Runs once per launch, after the session is known. Called from the app's own
 * start-up and again after a sign-in, and it is safe to call repeatedly.
 */
export async function syncOnStart(): Promise<number> {
  if (started) return 0
  started = true
  return pullMissing()
}

/** After a sign-in: the new PC catches up before the dashboard is shown. */
export async function syncAfterSignIn(): Promise<number> {
  started = true
  return pullMissing()
}
