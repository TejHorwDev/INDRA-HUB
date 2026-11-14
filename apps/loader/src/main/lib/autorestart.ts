/*
 * Whether to restart into a downloaded update without asking.
 *
 * A silent restart is the nicest thing an updater can do and the rudest thing it
 * can do, and the difference is entirely a question of timing. Restarting while
 * somebody is typing a password, or half way through a download, is a bug.
 * Restarting three seconds after launch, before they have touched anything, is
 * the app quietly becoming current.
 *
 * So the rule is narrow on purpose: only in the first minute, only while the
 * window still shows the splash or the landing screen, only with a verified
 * payload waiting, and only once per run.
 *
 * Kept separate from the Electron module so it can be tested as what it is — a
 * decision, not a side effect.
 */

/**
 * How long after launch a silent restart is still considered welcome.
 *
 * A minute was too short to be reachable: the check alone can take a cold panel half
 * of one, and the download the other half, so the update landed a second after the
 * window had closed. Ten minutes still means "before you have started anything",
 * because the other half of the rule — the splash or the landing screen, never a form
 * and never the library — is what actually protects the person using it.
 */
export const AUTO_RESTART_WINDOW_MS = 10 * 60_000

export interface AutoRestartInput {
  /** Off in development: a reload loop there is worse than being out of date. */
  packaged: boolean
  phase: string
  /** The screen the renderer last reported. */
  screen: string
  runningForMs: number
  /** One silent restart per run, always. */
  alreadyRestarted: boolean
  /**
   * True when a previous silent restart did not change the running version —
   * the payload did not load. Retrying would be an endless loop.
   */
  blocked: boolean
}

/**
 * Screens that mean "the user has not started anything yet."
 *
 * `signin` is deliberately not among them: that is a form with a password in it.
 */
const IDLE_SCREENS = new Set(['splash', 'landing'])

export function shouldAutoRestart(input: AutoRestartInput): boolean {
  if (!input.packaged) return false
  if (input.phase !== 'ready') return false
  if (!IDLE_SCREENS.has(input.screen)) return false
  if (input.runningForMs > AUTO_RESTART_WINDOW_MS) return false
  if (input.alreadyRestarted) return false
  if (input.blocked) return false
  return true
}
