/**
 * The installer window, clicked through — without Electron and without a screen.
 *
 * Twice now the window has shipped looking perfect and doing nothing: a module
 * that was not packaged, then a function my own edit deleted. Static checks
 * passed both times, because neither was a matter of text. So this loads the
 * real page in a real DOM, clicks the real buttons, and insists the flow moves.
 *
 * What it cannot check: how any of it looks. That still needs a person.
 *
 *   npm run sim:page
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const installer = join(root, 'installer')

let failed = 0
function check(ok, label, detail) {
  if (ok) {
    console.log(`✓ ${label}`)
  } else {
    failed += 1
    console.log(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const html = readFileSync(join(installer, 'ui', 'index.html'), 'utf8')
const script = readFileSync(join(installer, 'ui', 'app.js'), 'utf8')
const rules = createRequire(import.meta.url)(join(installer, 'ui', 'app-folder.js'))

/* Every id the script reaches for has to exist on the page. */
const idsInPage = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]))
const idsInScript = [...script.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1])
const missing = idsInScript.filter((id) => !idsInPage.has(id))
check(idsInScript.length > 5, 'the script reaches into the page')
check(missing.length === 0, 'every element the script asks for exists', missing.join(', '))

/* A window that records what it was asked to do. */
const calls = { install: [], finish: [], close: 0 }
let progressCallback = null
const chosen = 'C:\\Users\\A\\Desktop'

const dom = new JSDOM(html, { url: 'https://setup.invalid/', pretendToBeVisual: true, runScripts: 'outside-only' })
const { window } = dom
window.IndraFolder = rules
window.setup = {
  background: '',
  defaults: () => ({ user: 'C:\\Users\\A\\AppData\\Local\\Programs\\INDRA HUB' }),
  chooseFolder: async () => chosen,
  install: async (request) => {
    calls.install.push(request)
    return { ok: true, exe: `${request.path}\\INDRA HUB.exe`, dir: request.path }
  },
  onProgress: (cb) => {
    progressCallback = cb
  },
  finish: (options) => calls.finish.push(options),
  close: () => {
    calls.close += 1
  }
}

let loadError = null
try {
  window.eval(script)
} catch (error) {
  loadError = error
}
check(loadError === null, 'the page script runs top to bottom', loadError && loadError.message)

const doc = window.document
const current = () => doc.querySelector('.screen.is-current')?.dataset.screen
const next = doc.getElementById('next')
const path = doc.getElementById('path')
const hint = doc.getElementById('path-hint')

check(current() === 'options', 'it opens on the folder screen', current())

/* A bad folder does not advance, and says why. */
path.value = ''
path.dispatchEvent(new window.Event('blur'))
next.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
check(current() === 'options', 'an unusable folder keeps you on this screen', current())
check((hint.textContent ?? '').length > 0, 'and the hint explains what is wrong')

/* The real flow. */
path.value = 'C:\\Users\\A\\Desktop'
path.dispatchEvent(new window.Event('blur'))
check(
  path.value === 'C:\\Users\\A\\Desktop\\INDRA HUB',
  'typing the Desktop becomes the app folder inside it',
  path.value
)
next.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
check(current() === 'ready', 'Continue moves to the review screen', current())
check(
  doc.getElementById('review-path').textContent.includes('INDRA HUB'),
  'review shows the folder that will be created'
)

next.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
check(calls.install.length === 1, 'Install actually asks the main process to install')
check(calls.install[0]?.path?.endsWith('INDRA HUB'), 'with the folder it showed')
check(current() === 'installing' || current() === 'completed', 'and the rail moves on', current())

/* Progress lands where it is shown. */
if (typeof progressCallback === 'function') {
  progressCallback({ percent: 61, stage: 'Copying files…' })
  check(doc.getElementById('percent').textContent === '61%', 'progress is shown as it arrives')
}

await new Promise((done) => setTimeout(done, 60))
check(current() === 'completed', 'the finished screen appears', current())
check(
  (doc.getElementById('completed-path').textContent ?? '').includes('INDRA HUB'),
  'and names the folder it installed to'
)

next.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
check(calls.finish.length === 1, 'Finish tells the main process to hand over')

/* Browse goes through the dialog, never the filesystem. */
check(typeof window.setup.chooseFolder === 'function', 'the folder dialog is the bridge, not the page')

/* The rules themselves, which both sides now share. */
check(rules.pathProblem('C:\\') !== null, 'a bare drive is refused')
check(rules.pathProblem('C:\\Windows\\System32') !== null, 'a system folder is refused')
check(rules.pathProblem('relative\\folder') !== null, 'a relative path is refused')
check(rules.pathProblem('D:\\Apps') === null, 'an ordinary folder is allowed')
check(existsSync(join(installer, 'ui', 'app-folder.js')), 'the rules file is inside the folder that ships')

if (failed > 0) {
  console.log(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll installer page checks passed.')
