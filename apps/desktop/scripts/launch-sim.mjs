/**
 * The launch card's decisions, run without a window.
 *
 * The card itself needs a display; what it *does* does not. This pins the part
 * that can actually be wrong:
 *
 *   - an update in flight reads as downloading, never as checking;
 *   - a verified payload is the only thing that triggers a restart;
 *   - "up to date", an error or an unsupported platform closes the card and
 *     opens the app — a launch screen must never be the reason the app is
 *     unreachable;
 *   - a stage never runs backwards, and each one is held long enough to read.
 *
 *   npm run sim:launch
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-launch-sim')

let failures = 0
const check = (pass, label, detail) => {
  if (pass) console.log(`✓ ${label}`)
  else {
    failures += 1
    console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

async function main() {
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })

  const bundle = join(work, 'stages.cjs')
  await build({
    entryPoints: [join(root, 'src/main/launch-stages.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    logLevel: 'warning'
  })

  const require = createRequire(import.meta.url)
  const { stageForPhase, LAUNCH_HOLD, isForward } = require(bundle)

  /* ---------------- the mapping ---------------- */

  check(stageForPhase('idle') === 'checking', 'before anything starts, the card says it is checking')
  check(stageForPhase('checking') === 'checking', 'a check in flight keeps the same sentence')
  check(stageForPhase('available') === 'downloading', 'an available release is a download')
  check(stageForPhase('downloading') === 'downloading', 'progress stays on the download line')
  check(stageForPhase('ready') === 'restarting', 'only a verified payload restarts')
  check(stageForPhase('up-to-date') === 'done', 'up to date: close the card, open the app')
  check(stageForPhase('error') === 'done', 'an error still opens the app')
  check(stageForPhase('unsupported') === 'done', 'an unsupported platform opens the app')

  /* ---------------- nothing can go backwards ---------------- */

  const order = ['checking', 'downloading', 'restarting', 'done']
  let monotonic = true
  for (let from = 0; from < order.length; from += 1) {
    for (let to = 0; to < order.length; to += 1) {
      const expected = to >= from
      if (isForward(order[from], order[to]) !== expected) monotonic = false
    }
  }
  check(monotonic, 'a later state never replaces an earlier one with something behind it')
  check(!isForward('restarting', 'checking'), 'a late read cannot put "Checking…" back under "Restarting…"')
  check(!isForward('downloading', 'checking'), 'nor under a download already under way')

  /* ---------------- the holds are readable ---------------- */

  check(LAUNCH_HOLD.checking >= 800, 'the first sentence is held long enough to read', String(LAUNCH_HOLD.checking))
  check(LAUNCH_HOLD.downloading >= 1200, 'a download that finishes instantly still shows its line', String(LAUNCH_HOLD.downloading))
  check(LAUNCH_HOLD.restarting >= 1000, '"Restarting…" is visible before the process leaves', String(LAUNCH_HOLD.restarting))
  const total = LAUNCH_HOLD.checking + LAUNCH_HOLD.downloading + LAUNCH_HOLD.restarting
  check(total <= 4000, 'the whole update sequence stays under four seconds of enforced waiting', String(total))

  /* ---------------- the sequence a launch actually walks ---------------- */

  /* The phases the updater publishes, in the order a real update produces them. */
  const updating = ['idle', 'checking', 'available', 'downloading', 'ready']
  const walked = []
  for (const phase of updating) {
    const stage = stageForPhase(phase)
    if (stage !== 'done' && walked[walked.length - 1] !== stage) walked.push(stage)
  }
  check(
    JSON.stringify(walked) === JSON.stringify(['checking', 'downloading', 'restarting']),
    'an update reads checking, downloading, restarting — in that order',
    JSON.stringify(walked)
  )

  const noUpdate = ['idle', 'checking', 'up-to-date']
  const quiet = []
  for (const phase of noUpdate) {
    const stage = stageForPhase(phase)
    if (stage !== 'done' && quiet[quiet.length - 1] !== stage) quiet.push(stage)
  }
  check(JSON.stringify(quiet) === JSON.stringify(['checking']), 'no update: one line, then the app', JSON.stringify(quiet))

  /* A failed check after a download started still has to release the app. */
  const failing = ['checking', 'downloading', 'error']
  check(stageForPhase(failing[2]) === 'done', 'a failure mid-download releases the launch card')

  /* ---------------- the ring keeps turning ---------------- */

  /*
   * The app answers a reduced-motion system by shortening every animation to a
   * fraction of a millisecond and cancelling it after one iteration. A loading
   * ring that obeys that is painted once and never turns, which looks exactly
   * like a frozen app — this happened, and it read as "the spinner is broken".
   * These three must out-specify that reset, which is `!important`.
   */
  const design = readFileSync(join(root, 'src/renderer/src/styles/design.css'), 'utf8')
  const splashCss = readFileSync(join(root, 'src/renderer/src/styles/splash.css'), 'utf8')
  const reducedBlocks = [...design.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1])
  const spinnerGuard = reducedBlocks.find((block) => block.includes('.opening-spinner svg')) ?? ''
  check(spinnerGuard.includes('.opening-spinner svg'), 'the opening ring has a reduced-motion rule of its own')
  check(spinnerGuard.includes('.spinner'), 'the inline busy spinners are covered too')
  check(/animation-duration:\s*2\.6s\s*!important/.test(spinnerGuard), 'its duration beats the global reset with !important')
  check(/animation-iteration-count:\s*infinite\s*!important/.test(spinnerGuard), 'and it is allowed to keep turning')
  check(
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation-duration:\s*2\.8s\s*!important[\s\S]*?animation-iteration-count:\s*infinite\s*!important/.test(splashCss),
    'the launch card\'s ring survives it as well'
  )

  console.log(
    failures === 0
      ? '\nlaunch card: all checks passed'
      : `\n${failures} check(s) failed`
  )
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
