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

/* ---------------------------------------------------------------- catalogue */

export interface LoaderApp {
  id: string
  name: string
  description: string
  version: string
  /** Absolute URL of the card image. Empty is valid: the card draws a monogram. */
  image: string
  fileUrl: string
  /** The product's id in INDRA Auth. Empty means the app is not gated. */
  keyauthAppId: string
  status: 'active' | 'locked'
}

/** Always all five keys, empty string when unset. */
export interface LoaderConfig {
  website: string
  instagram: string
  tiktok: string
  discord: string
  youtube: string
}

export interface Catalogue {
  apps: LoaderApp[]
  config: LoaderConfig
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
    /**
     * The product ids this account owns, from INDRA Auth. The single source of
     * entitlement; empty means "nothing owned", never "unknown".
     */
    owned: () => Promise<string[]>
    logout: () => Promise<void>
    session: () => Promise<SessionInfo | null>
  }

  catalogue: {
    load: () => Promise<Catalogue>
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
