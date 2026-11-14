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
import { createRequire } from 'node:module'
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

/* ---- 2b. the window is small, and the folder is really chosen -------- */

const size = (main.match(/width:\s*(\d+),\s*\n\s*height:\s*(\d+)/) ?? []).slice(1).map(Number)
check(size.length === 2, 'the window size is declared')
check(size[0] <= 920 && size[1] <= 620, 'and it is a compact window, not a canvas', `${size[0]}×${size[1]}`)

check(/id="path"/.test(html) && /id="browse"/.test(html), 'the page has a folder field and a Browse button')
check(/setup:defaults/.test(main), 'the main process offers the default folders')
check(/setup:choose-folder/.test(main), 'and owns the folder picker')
check(/showOpenDialog/.test(main) && /openDirectory/.test(main), 'the picker is the real system dialog')
check(/background:\s*\(\)/.test(preload) && /chooseFolder/.test(preload), 'the bridge exposes both')
check(/bridge\?\.chooseFolder/.test(script), 'and the page asks the dialog, never the filesystem')
check(/bridge\?\.defaults/.test(script), 'and starts from the defaults it is given')

/* The folder reaches NSIS as /D, which must be last and unquoted. */
check(/`\/D=\$\{target\.dir\}`|'\/D='|`\/D=/.test(main), 'the chosen folder is passed as /D')
check(/windowsVerbatimArguments:\s*true/.test(main), 'unquoted, as NSIS requires for /D')
check(
  /\^\[a-zA-Z\]:\\/.test(main),
  'and the main process rejects anything that is not an absolute drive path'
)

/* ---- 2c. the app gets its own folder inside whatever was chosen ---- */

const { ensureAppFolder } = createRequire(import.meta.url)(join(installer, 'ui', 'app-folder.js'))
check(
  ensureAppFolder('C:\\Users\\A\\Desktop') === 'C:\\Users\\A\\Desktop\\INDRA HUB',
  'choosing the Desktop installs into Desktop\\INDRA HUB, not loose on it',
  ensureAppFolder('C:\\Users\\A\\Desktop')
)
check(
  ensureAppFolder('C:\\Apps\\INDRA HUB') === 'C:\\Apps\\INDRA HUB',
  'a folder already named for the app is left alone'
)
check(
  ensureAppFolder('D:\\Apps\\INDRA HUB\\') === 'D:\\Apps\\INDRA HUB',
  'and a trailing slash does not create a second one'
)
check(ensureAppFolder('') === '', 'an empty choice stays empty')

check(/require\('\.\/ui\/app-folder'\)/.test(main), 'the main process uses that rule')
check(/<script src="app-folder\.js"><\/script>/.test(html), 'and so does the page')
check(/path\.dirname\(suggested\)/.test(main), 'the picker opens where the app would be created')
check(/dir: target\.dir/.test(main), 'the window is told the folder that was really used')

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

/* The bug this replaces: a require of a file the packaging step did not copy,
   so the window died on its first line on Windows while every check here
   passed. Every relative require in main.js must be inside the file list. */
const packaged = (() => {
  const yml = readFileSync(join(installer, 'electron-builder.yml'), 'utf8')
  const block = yml.slice(yml.indexOf('files:'))
  const list = block.slice(0, block.indexOf('compression')).split('\n')
  return list.filter((line) => /^\s+-\s+[^!]/.test(line)).map((line) => line.replace(/^\s+-\s+/, '').trim())
})()
const requires = [...main.matchAll(/require\('\.\/([^']+)'\)/g)].map((m) => m[1])
check(requires.length > 0, 'the main process does require something of its own')
for (const wanted of requires) {
  const file = wanted.endsWith('.js') ? wanted : `${wanted}.js`
  const covered = packaged.some((glob) =>
    glob.endsWith('/**/*') ? file.startsWith(glob.replace('/**/*', '/')) : glob === file
  )
  check(
    existsSync(join(installer, file)) && covered,
    `"${file}" is required by main.js and is shipped in the installer`
  )
}
check(packaged.includes('ui/**/*'), 'the ui folder is what the file list covers')

console.log('')
if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('All installer window checks passed.')
}
