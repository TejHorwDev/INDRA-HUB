/**
 * The updater, proven without a window.
 *
 * Two things are checked here, and they are the two that can silently rot:
 *
 *  1. Release selection. Both apps publish from one repository, so the loader
 *     asks for the release *list* and filters by tag prefix. A `releases/latest`
 *     implementation looks correct and, the first time the hub ships, offers the
 *     hub's payload to the loader. The fixture below is that exact situation.
 *
 *  2. Payload adoption. A downloaded payload must be adopted once, never
 *     adopted when it is damaged or older than the installed app, and abandoned
 *     after two failed starts.
 *
 *   npm run sim:update
 *
 * Nothing here touches the network, and nothing is published.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-loader-sim')

let failures = 0

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`)
  } else {
    failures += 1
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Builds one source file (plus its local imports) into an importable module. */
async function bundle(entry, outfile, { stubElectron = false } = {}) {
  await build({
    entryPoints: [join(root, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'silent',
    plugins: stubElectron ? [electronStub] : []
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

/**
 * A faithful-enough `electron`: only `app`, and only the three facts the payload
 * layer asks for. The version is read from globalThis so one bundle can be told
 * it is a different build between cases.
 */
const electronStub = {
  name: 'electron-stub',
  setup(build) {
    build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }))
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: `
        const stub = globalThis.__electron__ ?? {}
        export const app = {
          getVersion: () => stub.version ?? '0.0.0',
          getPath: (name) => (name === 'userData' ? stub.userData : stub.appData),
          isPackaged: true
        }
      `,
      loader: 'js'
    }))
  }
}

async function main() {
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })

  /* ---------------------------------------------------------------- 1. tags */

  console.log('\nRelease selection')
  const releases = await bundle(
    'src/main/lib/releases.ts',
    join(work, 'releases.mjs')
  )

  check('reads a version out of a loader tag', releases.versionFromTag('loader-v1.4.2', 'loader-v') === '1.4.2')
  check('refuses a hub tag', releases.versionFromTag('v2.9.30', 'loader-v') === null)
  check('refuses a loader tag with junk', releases.versionFromTag('loader-vnext', 'loader-v') === null)

  const fixture = [
    // The hub released most recently. This is the case a `latest` implementation
    // gets wrong, and the reason the selection is not `latest`.
    { tag_name: 'v2.9.30', published_at: '2026-11-20T10:00:00Z' },
    { tag_name: 'loader-v1.0.1', published_at: '2026-11-01T10:00:00Z' },
    { tag_name: 'loader-v1.0.10', published_at: '2026-11-02T10:00:00Z' },
    { tag_name: 'loader-v1.0.2', draft: true, published_at: '2026-11-19T10:00:00Z' },
    { tag_name: 'loader-v1.0.0', published_at: '2026-10-01T10:00:00Z' }
  ]

  const selected = releases.selectRelease(fixture, 'loader-v')
  check('ignores the newer hub release', selected?.tag === 'loader-v1.0.10', selected?.tag)
  check('compares versions numerically, not as text', selected?.version === '1.0.10', selected?.version)
  check('skips drafts', !fixture.filter((r) => r.draft).some((r) => r.tag_name === selected?.tag))

  const reordered = [...fixture].sort(() => 0.5 - Math.random())
  check(
    'is order-independent',
    releases.selectRelease(reordered, 'loader-v')?.tag === 'loader-v1.0.10'
  )

  check(
    'returns null when this app has never released',
    releases.selectRelease([{ tag_name: 'v2.9.30' }], 'loader-v') === null
  )

  check(
    'builds the manifest URL from the tag',
    releases.manifestUrl('TejHorwDev/INDRA-HUB', 'loader-v1.0.1') ===
      'https://github.com/TejHorwDev/INDRA-HUB/releases/download/loader-v1.0.1/payload.json'
  )

  /* ------------------------------------------------------------- 2. payload */

  console.log('\nPayload adoption')
  const userData = join(work, 'userdata')
  mkdirSync(userData, { recursive: true })
  globalThis.__electron__ = { version: '1.0.0', userData }

  const payload = await bundle('src/main/lib/payload.ts', join(work, 'payload.mjs'), {
    stubElectron: true
  })

  const body = 'payload for 1.0.1'
  const file = 'INDRA-LOADER-Payload-1.0.1.asar.download'
  const path = join(userData, 'update')
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, file), body)
  const sha256 = createHash('sha256').update(body).digest('hex')
  const size = statSync(join(path, file)).size

  payload.writePending({ version: '1.0.1', file, sha256, size })
  const adopted = payload.resolveActivePayload()
  check('adopts a verified payload', adopted?.version === '1.0.1', JSON.stringify(adopted))
  check('consumes the pending record', payload.readPending() === null)
  check('reports the payload version as running', payload.runningVersion() === '1.0.1')

  // Second start of the same payload: adopted again, attempts goes to 1.
  check('adopts it again on the next start', payload.resolveActivePayload()?.version === '1.0.1')

  // Two failed starts in a row is the abandonment rule.
  check('abandons after two failed starts', payload.resolveActivePayload() === null)
  check('falls back to the installed version', payload.runningVersion() === '1.0.0')

  // A damaged payload is never adopted.
  payload.discardActive()
  writeFileSync(join(path, file), body)
  payload.writePending({ version: '1.0.1', file, sha256, size })
  appendFileSync(join(path, file), 'corruption')
  check('refuses a payload whose hash does not match', payload.resolveActivePayload() === null)

  // A payload older than the installed app is a downgrade, not an update.
  rmSync(path, { recursive: true, force: true })
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, file), body)
  payload.writePending({ version: '0.9.0', file, sha256: createHash('sha256').update(body).digest('hex'), size })
  check('refuses a downgrade', payload.resolveActivePayload() === null)

  /* ------------------------------------------------------ silent restarting */

  /*
   * The decision to restart without asking is the one place the updater can do
   * real damage — it takes a running app away from somebody. Every way it must
   * refuse is checked, not just the happy path.
   */
  const { shouldAutoRestart, AUTO_RESTART_WINDOW_MS } = await bundle(
    'src/main/lib/autorestart.ts',
    join(work, 'autorestart.mjs')
  )

  const base = {
    packaged: true,
    phase: 'ready',
    screen: 'landing',
    idle: true,
    runningForMs: 4_000,
    alreadyRestarted: false,
    blocked: false
  }
  const ask = (over) => shouldAutoRestart({ ...base, ...over })

  check('restarts before anything has been started', ask({}) === true)
  check('restarts on the splash too', ask({ screen: 'splash' }) === true)
  check('restarts while a session is being verified', ask({ screen: 'verifying' }) === true)

  /*
   * The screen is not the thing being protected; the work on it is. These two pairs
   * are the whole rewrite, and the reason an update used to sit on disk until the
   * next manual restart: the sign-in form with empty fields and the library with
   * nothing downloading are both moments a restart costs nothing.
   */
  check('restarts on an untouched sign-in form', ask({ screen: 'signin' }) === true)
  check('never while a password is being typed', ask({ screen: 'signin', idle: false }) === false)
  check('restarts over an idle library', ask({ screen: 'home' }) === true)
  check('never while a product is downloading', ask({ screen: 'home', idle: false }) === false)
  check('restarts from settings when nothing is running', ask({ screen: 'settings' }) === true)
  check('never while a setting is being typed', ask({ screen: 'settings', idle: false }) === false)

  // The launch card runs its own sequence and would fight this rule for the same
  // payload. Unknown screens are somebody's work, not ours to interrupt.
  check('never while the launch card is up', ask({ screen: 'launch-card' }) === false)
  check('never on a screen it does not know', ask({ screen: 'something-new' }) === false)

  check(
    'never after the welcome window has passed',
    ask({ runningForMs: AUTO_RESTART_WINDOW_MS + 1 }) === false
  )
  check('only once per run', ask({ alreadyRestarted: true }) === false)
  check('never when the last restart changed nothing', ask({ blocked: true }) === false)
  check('never before the payload is ready', ask({ phase: 'downloading' }) === false)
  check('never in development', ask({ packaged: false }) === false)

  /* Every refusal can explain itself, which is what goes in the log the panel shows. */
  const { restartBlocker } = await bundle('src/main/lib/autorestart.ts', join(work, 'ar2.mjs'))
  check('the refusal names the reason', restartBlocker({ ...base, screen: 'home', idle: false }).includes('in hand'))
  check('an allowed restart has no reason', restartBlocker(base) === null)

  /*
   * The two facts the rewrite exists for, checked in the source rather than in a
   * decision function, because they are wiring and wiring is what silently rots:
   *
   *  - the window reports what is in hand, and the report re-asks the question,
   *  - a ready payload that was refused is asked about again later, so it can never
   *    be stranded on disk until somebody happens to restart the app by hand.
   */
  const service = readFileSync(join(root, 'src/main/services/updates.ts'), 'utf8')
  const renderer = readFileSync(join(root, 'src/renderer/src/App.tsx'), 'utf8')
  const ipc = readFileSync(join(root, 'src/main/ipc/index.ts'), 'utf8')

  check('the window reports what is in hand', /update:activity/.test(ipc))
  check('a focus change reports it', /focusin/.test(renderer) && /focusout/.test(renderer))
  check('the report re-asks the restart question', /noteActivity[\s\S]{0,400}maybeAutoRestart/.test(service))
  check('a ready payload is asked about again', /reconsider/.test(service))
  check('and the log says why it waited', /auto-restart: waiting/.test(service))
  check(
    'the guard cannot outlive the version it names',
    /blockedVersion/.test(service) && !/restartBlocked/.test(service)
  )
  check('a manual install clears the guard', /installUpdate\(\{ manual: true \}\)/.test(ipc))

  /* A restart that lands on a password box is the bug this pairs with. */
  const auth = readFileSync(join(root, 'src/main/services/auth.ts'), 'utf8')
  check('the session is remembered through the OS secret store', /safeStorage\.encryptString/.test(auth))
  check('and never written in the clear', !/writeFileSync\(sessionFile\(\), JSON\.stringify/.test(auth))
  check('the remembered session is asked for at boot', /auth\.restore\(\)/.test(renderer))

  /* --------------------------------------------------------- the launch card */

  const stages = await bundle('src/main/launch-stages.ts', join(work, 'launch-stages.mjs'))

  console.log('')
  check('the card starts by checking', stages.stageForPhase('idle') === 'checking')
  check('a download is the downloading stage', stages.stageForPhase('downloading') === 'downloading')
  check('a ready payload is the restarting stage', stages.stageForPhase('ready') === 'restarting')
  check('being current ends the card', stages.stageForPhase('up-to-date') === 'done')
  check('a failure ends the card too', stages.stageForPhase('error') === 'done')
  check('a stage never goes backwards', stages.isForward('downloading', 'checking') === false)
  check('and does move forwards', stages.isForward('checking', 'downloading') === true)
  // A payload this size downloads in under a second; without a floor the card
  // would flash its sentences and read as a glitch.
  const holds = Object.values(stages.LAUNCH_HOLD)
  check('every sentence is held long enough to read', holds.every((ms) => ms >= 800), holds.join('/'))

  console.log(
    failures === 0
      ? '\n✓ The updater picks the right release, adopts only a payload it can trust, and restarts only when nobody is looking.\n'
      : `\n✗ ${failures} check(s) failed.\n`
  )
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
