import type { UpdatePhase } from '@shared/types'

/*
 * What the launch card should say, given what the updater is doing.
 *
 * Kept apart from the window so it can be tested without a display: the part
 * that can be wrong is the decision, not the flicker of a spinner.
 */

export type LaunchStage = 'checking' | 'downloading' | 'restarting' | 'done'

/**
 * How long each sentence is held, at minimum, before the next one may replace
 * it. A 1.5 MB payload downloads in well under a second; without a floor the
 * card would flash "Downloading update 1 of 1…" for 80 ms and read as a glitch.
 */
export const LAUNCH_HOLD: Record<Exclude<LaunchStage, 'done'>, number> = {
  checking: 900,
  downloading: 1400,
  restarting: 1100
}

/** The stage a phase maps to. `checking` covers idle and a check in flight. */
export function stageForPhase(phase: UpdatePhase): LaunchStage {
  switch (phase) {
    case 'available':
    case 'downloading':
      return 'downloading'
    case 'ready':
      return 'restarting'
    case 'up-to-date':
    case 'error':
    case 'unsupported':
      return 'done'
    default:
      return 'checking'
  }
}

/**
 * The order a run is allowed to pass through. A stage never goes backwards:
 * once "Restarting…" is on screen, a late state read cannot put "Checking…"
 * back under it.
 */
const ORDER: LaunchStage[] = ['checking', 'downloading', 'restarting', 'done']

export function isForward(from: LaunchStage, to: LaunchStage): boolean {
  return ORDER.indexOf(to) >= ORDER.indexOf(from)
}
