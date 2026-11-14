import { app } from 'electron'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { compareVersions } from './version'

/*
 * In-app updates, without an installer.
 *
 * A release ships two things: the one-time Windows installer, and a small
 * payload — the compiled `out/` directory packed as a single `.asar`, a few
 * megabytes. An installed copy downloads the payload, verifies its SHA-256, and
 * on the next start the bootstrap runs *that* code instead of the copy inside
 * the installer. Nothing is executed from the network, no wizard appears, and
 * no installer runs again.
 *
 * The failure modes are deliberately boring:
 *
 *  - missing file, wrong size or wrong hash  → ignore it, run the installed code
 *  - payload newer than the app              → run it (never a downgrade)
 *  - payload loaded but the app never became healthy twice in a row
 *                                            → drop it and go back to the
 *                                              installed copy, automatically
 *
 * So the worst case is "the update did not take", never "the app will not open".
 *
 * One trap worth naming: Electron's asar layer hijacks *every* filesystem path
 * that contains ".asar", not just the archive the app was loaded from. A payload
 * sitting in userData is therefore read through the archive reader, which
 * answers `Invalid package <path>` — a download that verified perfectly would
 * still be rejected and no update would ever apply. Every raw read of a payload
 * goes through `asPlainFile` because of this, the download is written under a
 * name that contains no such substring, and deletions use `unlink` rather than
 * `rm` (which is built on `lstat`, and is intercepted the same way).
 */

const FOLDER = 'update'
const STATE_FILE = 'state.json'
const PENDING_FILE = 'pending.json'

/** Two unsuccessful starts in a row and the payload is abandoned. */
const MAX_ATTEMPTS = 2

interface StoredPayload {
  version: string
  file: string
  sha256: string
  size: number
  attempts: number
}

export interface ActivePayload {
  path: string
  version: string
}

/**
 * Runs a filesystem call with Electron's asar layer switched off.
 *
 * Synchronous on purpose: the flag is global to the process, so it must never be
 * held across an `await`. Every caller here is a one-shot read or stat.
 */
function asPlainFile<T>(operation: () => T): T {
  const previous = process.noAsar
  process.noAsar = true
  try {
    return operation()
  } finally {
    process.noAsar = previous
  }
}

function folder(): string {
  const path = join(app.getPath('userData'), FOLDER)
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
  return path
}

function statePath(): string {
  return join(folder(), STATE_FILE)
}

export function pendingPath(): string {
  return join(folder(), PENDING_FILE)
}

export function payloadDir(): string {
  return folder()
}

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as T
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function writeJson(path: string, value: unknown): void {
  try {
    writeFileSync(path, JSON.stringify(value), 'utf8')
  } catch (error) {
    console.error('[payload] could not write', path, error)
  }
}

/** Deletes a file, and never through `rm` — see the note at the top. */
function remove(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    try {
      rmSync(path, { force: true, recursive: true })
    } catch {
      // Nothing to do: a file we cannot delete is a file we will simply ignore.
    }
  }
}

function readState(): StoredPayload | null {
  const state = readJson<StoredPayload>(statePath())
  if (!state || typeof state.version !== 'string' || typeof state.file !== 'string') return null
  return {
    version: state.version,
    file: state.file,
    sha256: typeof state.sha256 === 'string' ? state.sha256 : '',
    size: Number(state.size) || 0,
    attempts: Number(state.attempts) || 0
  }
}

/** Reads the payload the app downloaded but has not started yet. */
export function readPending(): StoredPayload | null {
  const state = readJson<StoredPayload>(pendingPath())
  if (!state || typeof state.version !== 'string' || typeof state.file !== 'string') return null
  return {
    version: state.version,
    file: state.file,
    sha256: typeof state.sha256 === 'string' ? state.sha256 : '',
    size: Number(state.size) || 0,
    attempts: 0
  }
}

/** Removes a payload file by name, safely even when the name ends in `.asar`. */
export function removePayloadFile(name: string): void {
  remove(join(folder(), name))
}

/**
 * Clears download debris left by a failed or interrupted attempt.
 *
 * Called once at startup, before anything can start downloading, so it can
 * never race a file that is still being written.
 */
export function prunePayloadDir(): void {
  let entries: string[]
  try {
    entries = readdirSync(folder())
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.endsWith('.part') || entry.endsWith('.download')) {
      console.warn('[payload] removing unfinished download', entry)
      remove(join(folder(), entry))
    }
  }
}

/**
 * A pending download that still matches a file on disk.
 *
 * `readPending` only reads the record, which is right for the bootstrap — it
 * consumes the download. Anything that *reports* a download as ready should use
 * this instead, so a deleted or half-written file can never be announced as an
 * update that will install.
 */
export function readVerifiedPending(): StoredPayload | null {
  const pending = readPending()
  if (!pending) return null
  if (isValid(pending)) return pending

  console.warn('[payload] discarding unusable download', pending.file)
  remove(join(folder(), pending.file))
  clearPending()
  return null
}

/**
 * Records a fresh download. Nothing is activated here: the file is only adopted
 * at the next start, once it has been verified again.
 */
export function writePending(payload: {
  version: string
  file: string
  sha256: string
  size: number
}): void {
  writeJson(pendingPath(), { ...payload, attempts: 0 })
}

export function clearPending(): void {
  remove(pendingPath())
}

/** Removes the active payload so the installed copy runs again. */
export function discardActive(): void {
  remove(statePath())
}

/** Called once the app is genuinely up. A payload that booted is healthy. */
export function markHealthy(): void {
  const state = readState()
  if (state && state.attempts !== 0) writeJson(statePath(), { ...state, attempts: 0 })
}

export function hashFile(path: string): string {
  return asPlainFile(() => createHash('sha256').update(readFileSync(path)).digest('hex'))
}

function bytes(file: string): number {
  return asPlainFile(() => {
    try {
      return statSync(file).size
    } catch {
      return -1
    }
  })
}

function isValid(payload: StoredPayload): boolean {
  const file = join(folder(), payload.file)
  if (bytes(file) !== payload.size) return false
  try {
    return hashFile(file) === payload.sha256
  } catch {
    return false
  }
}

/**
 * Runs at the very first line of the app: adopt a downloaded payload if there is
 * one, then decide which copy of the code should run.
 */
export function resolveActivePayload(): ActivePayload | null {
  const pending = readPending()
  if (pending) {
    clearPending()
    if (compareVersions(pending.version, app.getVersion()) > 0 && isValid(pending)) {
      // Adopted but untried: the boot below counts as the first attempt.
      writeJson(statePath(), { ...pending, attempts: 0 })
    }
  }

  const state = readState()
  if (!state) return null

  if (state.attempts >= MAX_ATTEMPTS) {
    console.warn('[payload] discarding', state.version, 'after repeated failed starts')
    discardActive()
    return null
  }

  // Never boot something older than the installed app, and never boot a file
  // that has changed since it was verified.
  if (compareVersions(state.version, app.getVersion()) <= 0 || !isValid(state)) {
    discardActive()
    return null
  }

  writeJson(statePath(), { ...state, attempts: state.attempts + 1 })
  return { path: join(folder(), state.file), version: state.version }
}

/**
 * The version actually running — the payload's, when one is active. Kept cheap:
 * the bootstrap already verified the file, and this is called to label the UI.
 */
export function runningVersion(): string {
  const state = readState()
  if (state && compareVersions(state.version, app.getVersion()) > 0) return state.version
  return app.getVersion()
}
