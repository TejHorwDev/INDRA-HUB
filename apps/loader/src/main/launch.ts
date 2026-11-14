/**
 * Startup order, in one place and testable.
 *
 * The bug this exists to prevent: the launch card was the only window, it was
 * destroyed when the check finished, `window-all-closed` fired, and the app
 * quit before its own window had been created. Every launch closed itself.
 *
 * So the rule is: the app window exists first, the card is only ever closed
 * after that window is on screen, and a card that fails still opens the app.
 *
 * Identical to the hub's, deliberately — both applications launch the same way,
 * so there is one startup order to reason about rather than two.
 */

export interface LaunchWindowLike {
  destroy: () => void
  isDestroyed?: () => boolean
}

export interface LaunchOutcome {
  card: LaunchWindowLike | null
  /** The process is about to relaunch into a new payload: do not open the app. */
  restarting: boolean
}

export interface LaunchPlan<TWindow extends LaunchWindowLike> {
  /** Creates the real window. It is not shown yet. */
  createAppWindow: () => TWindow
  /** Runs the card and its update check. Always resolves unless something broke. */
  runSplash: () => Promise<LaunchOutcome>
  /** Shows the app window, waiting for its first paint if necessary. */
  reveal: (window: TWindow) => void
  /** Shows the app even if the card never finishes. */
  scheduleFallback?: (reveal: () => void) => void
}

/**
 * Creates the app window, runs the card in front of it, then swaps.
 *
 * Returns the app window so the caller can wire the rest of its events; returns
 * `null` when a restart is under way, because no window should be shown.
 */
export async function startWithLaunchCard<TWindow extends LaunchWindowLike>(
  plan: LaunchPlan<TWindow>
): Promise<TWindow | null> {
  const appWindow = plan.createAppWindow()
  plan.scheduleFallback?.(() => plan.reveal(appWindow))

  let outcome: LaunchOutcome
  try {
    outcome = await plan.runSplash()
  } catch {
    /*
     * The card is a courtesy, not a requirement. If it cannot even run, the app
     * still opens.
     */
    plan.reveal(appWindow)
    return appWindow
  }

  if (outcome.restarting) return null

  plan.reveal(appWindow)

  /*
   * Only now. By this point the app window exists in the window list, so
   * destroying the card cannot be the last window closing.
   */
  const card = outcome.card
  if (card && !(card.isDestroyed?.() ?? false)) card.destroy()

  return appWindow
}
