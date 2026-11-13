/**
 * The installer window, checked without a display.
 *
 * The window is a small static page, so most of what can go wrong is a wiring
 * mistake rather than a rendering one: an id the script asks for that the page
 * never had, a screen the rail does not know about, a video that is packed into
 * the archive it cannot be streamed from. Those are all checkable here, and
 * they are exactly the mistakes that shipped once.
 *
 * What this cannot check: how it looks. That still needs a person and a screen.
 *
 *   npm run sim:installer
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const installer = join(root, 'installer')

let failures = 0
const ok = (message) => console.log(`✓ ${message}`)
const fail = (message) => {
  failures += 1
  console.error(`\n✗ ${message}`)
  process.exitCode = 1
}
const check = (condition, message, detail = '') => {
  if (condition) ok(message)
  else fail(`${message}${detail ? ` — ${detail}` : ''}`)
}

const read = (...parts) => readFileSync(join(installer, ...parts), 'utf8')

const html = read('ui', 'index.html')
const css = read('ui', 'style.css')
const script = read('ui', 'app.js')
const main = read('main.js')
const preload = read('preload.js')
const builder = read('electron-builder.yml')

/* ---- 1. the page and the script agree about what exists -------------- */

const ids = [...script.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((match) => match[1])
const missing = [...new Set(ids)].filter((id) => !html.includes(`id="${id}"`))
check(missing.length === 0, 'every element the script asks for is in the page', missing.join(', '))

const screens = [...html.matchAll(/data-screen="([^"]+)"/g)].map((match) => match[1])
const steps = [...html.matchAll(/data-step="([^"]+)"/g)].map((match) => match[1])
const order = (script.match(/const order = \[([^\]]+)\]/) ?? [])[1]
  ?.split(',')
  .map((entry) => entry.trim().replaceAll("'", ''))

check(screens.length === 4, 'the page has four screens', String(screens.length))
check(
  JSON.stringify(screens) === JSON.stringify(order),
  'and the script walks them in the order they are written'
)
check(
  JSON.stringify(steps) === JSON.stringify(screens),
  'the rail names the same four steps',
  steps.join(', ')
)

/* ---- 2. the design rules, mechanically ------------------------------- */

check(!/radial-gradient/.test(css), 'no radial gradients (the glow that was there before)')
check(!/box-shadow/.test(css), 'no box shadows', String((css.match(/box-shadow/g) ?? []).length))
check(!/text-shadow/.test(css), 'no text shadows')
check(!/backdrop-filter/.test(css), 'no glass blur')

const displayType = [...css.matchAll(/font-size:\s*([\d.]+)px/g)]
  .map((match) => Number(match[1]))
  .filter((size) => size > 32)
check(displayType.length === 0, 'no display-size type', displayType.join(', '))

const animations = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1])
check(animations.length <= 1, 'at most one keyframe animation', animations.join(', '))

/* ---- 3. the film: shipped outside the archive, wired end to end ------ */

check(
  /!\s*"?ui\/background\.mp4"?/.test(builder),
  'the film is excluded from the asar payload'
)
check(
  /from:\s*ui\/background\.mp4\s*\n\s*to:\s*background\.mp4/.test(builder),
  'and shipped beside the app as a resource'
)
check(/setup:background/.test(main), 'the main process answers for its location')
check(/background:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('setup:background'\)/.test(preload),
  'the page can ask for it through the bridge')
check(/bridge\?\.background/.test(script), 'and the page does ask')
check(
  /background\.mp4/.test(main) && /resourcesPath/.test(main),
  'the path is resolved in the main process, not by the page'
)

/* ---- 4. nothing remote, nothing opaque ------------------------------- */

check(/http-equiv="Content-Security-Policy"/.test(html), 'the page declares a CSP')
check(!/https?:\/\//.test(html), 'and loads nothing from the network')
check(!/eval\(|new Function/.test(script), 'the script never evaluates a string')
check(
  !/shell\.|child_process.*exec|execSync/.test(preload),
  'the bridge opens no shell and runs no command'
)

/* ---- 5. the splash --------------------------------------------------- */

const splash = join(installer, 'build', 'splash.bmp')
check(existsSync(splash), 'the splash exists')
if (existsSync(splash)) {
  const header = readFileSync(splash).subarray(0, 54)
  const width = header.readInt32LE(18)
  const height = header.readInt32LE(22)
  check(width === 620 && Math.abs(height) === 360, 'and is the size the window expects', `${width}×${height}`)
  check(header.subarray(0, 2).toString() === 'BM', 'and is a real bitmap')
  check(statSync(splash).size > 10_000, 'and is not blank', `${statSync(splash).size} bytes`)
}

/* ---- 6. the payload is still the stock installer --------------------- */

check(
  /inder-setup\.exe/.test(main) && /\/S/.test(main),
  'the install is still a silent run of the packaged NSIS installer'
)
check(
  !/electron-builder.*--publish/.test(main),
  'the window does not try to publish anything itself'
)

console.log('')
if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('All installer window checks passed.')
}
