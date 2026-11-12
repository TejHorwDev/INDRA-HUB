import { app } from 'electron'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

/*
 * In-app updates, without an installer.
 *
 * A release ships two things: the usual one-time Windows installer, and a small
 * payload — the compiled `out/` directory packed as a single `.asar` a couple of
 * megabytes in size. An installed copy downloads the payload, verifies its
 * SHA-256, and on the next start the bootstrap below runs *that* code instead of
 * the copy inside the installer. Nothing is ever executed from the network, no
 * wizard appears, and no installer runs again.
 *
 * The failure modes are deliberately boring:
 *
 *  - missing file, wrong size or wrong hash  → ignore it, run the installed code
 *  - payload newer than the app             → run it (never a downgrade)
 *  - payload loaded but the app never became ready twice in a row
 *                                           → drop it and go back to the
 *                                             installed copy, automatically
 *
 * So the worst case is "the update did not take", never "the app will not open".
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

function remove(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch {
    // Nothing to do: a file we cannot delete is a file we will simply ignore.
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
  return isValid(pending) ? pending : null
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

export function markHealthy(): void {
  const state = readState()
  if (state && state.attempts !== 0) writeJson(statePath(), { ...state, attempts: 0 })
}

export function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function bytes(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return -1
  }
}

/** Numeric compare of `1.2.10` against `1.2.9`. Returns <0, 0 or >0. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] =>
    value
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0))

  const a = parse(left)
  const b = parse(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function isValid(payload: StoredPayload): boolean {
  const file = join(folder(), payload.file)
  if (bytes(file) !== payload.size) return false
  // A hash of a couple of megabytes costs nothing and means a half-written
  // download can never be started.
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
  // A download that finished while the app was running becomes the candidate.
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
