/**
 * Startup order, against a fake window manager that quits when the last window
 * closes — because that is exactly what Electron does, and exactly what closed
 * the app on every launch.
 *
 * The claims:
 *
 *   - the real window exists before the card is ever destroyed;
 *   - destroying the card therefore cannot quit the app;
 *   - a restarting update shows no window and destroys nothing;
 *   - a card that throws still opens the app;
 *   - the fallback reveal still runs.
 *
 *   npm run sim:startup
 */
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-startup-sim')

let failures = 0
const check = (pass, label, detail) => {
  if (pass) console.log(`✓ ${label}`)
  else {
    failures += 1
    console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/** A window list with Electron's `window-all-closed` rule. */
function windowManager() {
  const windows = new Set()
  const order = []
  const state = { quit: false }

  const make = (name) => {
    const window = {
      name,
      destroyed: false,
      visible: false,
      destroy() {
        if (window.destroyed) return
        window.destroyed = true
        windows.delete(window)
        order.push(`destroy:${name}`)
        if (windows.size === 0) state.quit = true
      },
      show() {
        window.visible = true
        order.push(`show:${name}`)
      },
      isDestroyed: () => window.destroyed
    }
    windows.add(window)
    order.push(`create:${name}`)
    return window
  }

  return { windows, order, state, make }
}

async function main() {
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })

  const bundle = join(work, 'launch.cjs')
  await build({
    entryPoints: [join(root, 'src/main/launch.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    logLevel: 'warning'
  })

  const require = createRequire(import.meta.url)
  const { startWithLaunchCard } = require(bundle)

  /* ---------------- the normal launch ---------------- */

  {
    const wm = windowManager()
    let fallback = null
    const app = await startWithLaunchCard({
      createAppWindow: () => wm.make('app'),
      runSplash: async () => ({ card: wm.make('card'), restarting: false }),
      reveal: (window) => window.show(),
      scheduleFallback: (fn) => {
        fallback = fn
      }
    })

    check(Boolean(app), 'the app window is returned')
    check(!wm.state.quit, 'the app does not quit when the card closes', JSON.stringify(wm.order))
    check(app.visible, 'the app window is shown')
    check(wm.windows.has(app), 'the app window is still open')
    check(wm.windows.size === 1, 'only the app window remains', String(wm.windows.size))

    const created = wm.order.indexOf('create:app')
    const shown = wm.order.indexOf('show:app')
    const destroyed = wm.order.indexOf('destroy:card')
    check(created === 0, 'the real window is created first', JSON.stringify(wm.order))
    check(shown > -1 && destroyed > shown, 'the card closes only after the app is on screen', JSON.stringify(wm.order))
    check(typeof fallback === 'function', 'a fallback reveal is scheduled')
    fallback()
    check(wm.windows.size === 1, 'the fallback never opens a second window')
  }

  /* ---------------- relaunching into an update ---------------- */

  {
    const wm = windowManager()
    const app = await startWithLaunchCard({
      createAppWindow: () => wm.make('app'),
      runSplash: async () => ({ card: wm.make('card'), restarting: true }),
      reveal: (window) => window.show()
    })

    check(app === null, 'a restart reports no window to show')
    check(!wm.order.includes('show:app'), 'the app is not shown while the process relaunches')
    check(wm.order.includes('create:app'), 'the window still exists, so nothing quits early')
    check(!wm.order.includes('destroy:card'), 'the card is left for the process that is leaving')
    check(!wm.state.quit, 'and the app does not quit on its own')
  }

  /* ---------------- the card fails ---------------- */

  {
    const wm = windowManager()
    const app = await startWithLaunchCard({
      createAppWindow: () => wm.make('app'),
      runSplash: async () => {
        throw new Error('the card exploded')
      },
      reveal: (window) => window.show()
    })

    check(Boolean(app) && app.visible, 'a card that throws still opens the app')
    check(!wm.state.quit, 'and nothing quits')
  }

  /* ---------------- the card reports nothing ---------------- */

  {
    const wm = windowManager()
    const app = await startWithLaunchCard({
      createAppWindow: () => wm.make('app'),
      runSplash: async () => ({ card: null, restarting: false }),
      reveal: (window) => window.show()
    })

    check(Boolean(app) && app.visible, 'no card (a dev run) opens the app directly')
    check(!wm.state.quit, 'and nothing quits')
  }

  console.log(
    failures === 0 ? '\nstartup order: all checks passed' : `\n${failures} check(s) failed`
  )
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
