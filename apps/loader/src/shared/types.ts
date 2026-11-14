/*
 * The contract between the main process and the renderer.
 *
 * Everything here crosses the preload bridge, so it must stay plain data: no
 * functions, no class instances, nothing that cannot survive structured clone.
 */

/* ------------------------------------------------------------------ updates */

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
  version: string | null
  percent: number
  bytesPerSecond: number
  message: string | null
  /** The technical line, for diagnostics only. */
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

/* --------------------------------------------------------------------- auth */

export interface AuthSuccess {
  ok: true
  username: string
  expires: string | null
}

export interface AuthFailure {
  ok: false
  /** Already a sentence, from the server or from the client's own checks. */
  error: string
}

export type AuthResult = AuthSuccess | AuthFailure

export interface SessionInfo {
  username: string
  expires: string | null
}

/* ------------------------------------------------------------------- bridge */

export interface LoaderBridge {
  version: () => Promise<{ running: string; installed: string; packaged: boolean }>

  updates: {
    state: () => Promise<UpdateState>
    check: () => Promise<UpdateState>
    install: () => Promise<UpdateState>
    diagnose: () => Promise<UpdateDiagnostics>
    onState: (listener: (state: UpdateState) => void) => () => void
  }

  auth: {
    /** The token never leaves the main process — this returns who, not what. */
    login: (username: string, password: string) => Promise<AuthResult>
    logout: () => Promise<void>
    session: () => Promise<SessionInfo | null>
  }

  /** Opens a URL in the real browser. The main process allows https only. */
  links: {
    open: (url: string) => Promise<void>
  }

  window: {
    close: () => void
    minimize: () => void
  }
}
