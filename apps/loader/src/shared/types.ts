/*
 * The contract between the main process and the renderer.
 *
 * Everything here crosses the preload bridge, so it must stay plain data: no
 * functions, no class instances, nothing that cannot survive structured clone.
 */

/** Where the updater is in its life cycle. */
export type UpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  /** The version actually running — the payload's, when one is active. */
  currentVersion: string
  /** What the installer shipped. Differs from currentVersion after an update. */
  installedVersion: string
  /** The version being offered or downloaded. */
  version: string | null
  percent: number
  bytesPerSecond: number
  /** A sentence for the user. */
  message: string | null
  /** The technical line, for the diagnostics view only. */
  detail: string | null
  checkedAt: string | null
  canCheck: boolean
  canInstall: boolean
}

export interface UpdateDiagnostics {
  steps: Array<{ label: string; ok: boolean; detail: string }>
  latestVersion: string | null
  ok: boolean
  summary: string
}
