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
  /**
   * Optional SHA-256 of the executable. When the catalogue publishes one, a
   * download that arrives with different bytes is deleted instead of installed.
   */
  sha256: string
  status: 'active' | 'locked'
}

/* ------------------------------------------------------------------- files */

export type InstallState = 'absent' | 'downloading' | 'installed' | 'error'

export interface InstallView {
  id: string
  state: InstallState
  /** True while the launched process is alive. */
  running: boolean
  percent: number
  received: number
  total: number
  bytesPerSecond: number
  /** A sentence, already written for a person. */
  error: string | null
}

export interface LaunchResult {
  ok: boolean
  error?: string
}

/** Always all five keys, empty string when unset. */
/**
 * One link.
 *
 * The config used to carry five — website, Instagram, TikTok, Discord, YouTube —
 * and the app rendered them as a social row. They are gone: a loader that has
 * already been installed does not need to send you to Instagram. The database
 * keeps the columns for now so nothing breaks mid-flight; the app ignores them.
 */
export interface LoaderConfig {
  website: string
  /**
   * The sign-in backdrop. An absolute URL, or empty for the animated wash.
   *
   * Set from the admin panel, so the film can change without a release.
   */
  video: string
}

/** What the diagnostics button reports about the entitlement lookup. */
export interface EntitlementReport {
  ok: boolean
  status: number
  count: number
  ids: string[]
  error: string | null
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
    /**
     * Tells the main process which screen is showing.
     *
     * Only the updater uses it, and only to decide whether a silent restart is
     * welcome — a restart while a password is being typed is a bug, and the main
     * process cannot see the form.
     */
    screen: (screen: string) => void
    onState: (listener: (state: UpdateState) => void) => () => void
  }

  auth: {
    /** What `/v1/apps` actually answered, for when a card is wrongly locked. */
    probe: () => Promise<EntitlementReport>
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

  files: {
    /** Every product's install state, keyed by catalogue id. */
    states: () => Promise<Record<string, InstallView>>
    download: (id: string) => Promise<InstallView>
    cancel: (id: string) => Promise<InstallView>
    uninstall: (id: string) => Promise<InstallView>
    launch: (id: string) => Promise<LaunchResult>
    /** Shows the downloaded file in Explorer. */
    reveal: (id: string) => Promise<void>
    onState: (listener: (states: Record<string, InstallView>) => void) => () => void
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
