/*
 * Whether to restart into a downloaded update without asking.
 *
 * A silent restart is the nicest thing an updater can do and the rudest thing it
 * can do, and the difference is entirely a question of timing. Restarting while
 * somebody is typing a password, or half way through a download, is a bug.
 * Restarting three seconds after launch, before they have touched anything, is
 * the app quietly becoming current.
 *
 * The first version of this rule asked only *which screen* was showing, and it was
 * wrong in a way that took a while to see: screens are a poor proxy for what a
 * person is doing. Somebody sitting on the sign-in form with empty fields is not
 * doing anything; somebody halfway through typing a password is. Both are the
 * screen called `signin`. And the library — a screen full of products and nothing
 * in flight — was treated as "busy" forever, which is how an update downloaded at
 * launch ended up sitting on disk until the next manual restart.
 *
 * So the question changed. Not "which screen?" but *"is anything in hand?"* — and
 * the answer to that is reported by the window itself: is a text field focused or
 * filled, is a download running. Two facts, not a screen name.
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
 * because the other half of the rule — nothing in hand — is what actually protects
 * the person using it.
 */
export const AUTO_RESTART_WINDOW_MS = 10 * 60_000

export interface AutoRestartInput {
  /** Off in development: a reload loop there is worse than being out of date. */
  packaged: boolean
  phase: string
  /** The screen the renderer last reported. */
  screen: string
  /**
   * Nothing is in hand: no text field is focused or filled, and no product is
   * downloading. Reported by the window and by the download service.
   */
  idle: boolean
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
 * Screens where nothing has been touched yet.
 *
 * `verifying` belongs here: it is the spinner that runs while a remembered session
 * is checked, and there is nothing on it to lose.
 */
const UNTOUCHED_SCREENS = new Set(['splash', 'landing', 'verifying'])

/**
 * Screens that are fine to leave from, as long as nothing is in hand.
 *
 * `signin` is here now. The password is what makes that screen delicate, and the
 * password is precisely what `idle` measures — an empty form is not a password.
 */
const GATED_SCREENS = new Set(['signin', 'home', 'settings'])

export function shouldAutoRestart(input: AutoRestartInput): boolean {
  return restartBlocker(input) === null
}

/**
 * Why the restart was refused, in a few words, or `null` when it was not.
 *
 * The updater writes this to its log whenever the answer changes, because the one
 * question that has been impossible to answer from the outside is "it did not
 * restart — why?". Now the app answers it itself.
 */
export function restartBlocker(input: AutoRestartInput): string | null {
  if (!input.packaged) return 'not the installed app'
  if (input.phase !== 'ready') return `nothing waiting (${input.phase})`
  if (input.alreadyRestarted) return 'already restarted once'
  if (input.blocked) return 'this payload did not load last time'
  if (input.runningForMs > AUTO_RESTART_WINDOW_MS) return 'the window has passed'
  if (UNTOUCHED_SCREENS.has(input.screen)) return null
  if (GATED_SCREENS.has(input.screen)) {
    return input.idle ? null : `something in hand on ${input.screen}`
  }
  /*
   * An unknown screen is a screen somebody is using. `launch-card` arrives here on
   * purpose: the card runs its own update sequence and would fight this rule for
   * the same payload.
   */
  return `not a screen it may interrupt (${input.screen})`
}
