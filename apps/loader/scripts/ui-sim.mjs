/**
 * The window, checked as a window.
 *
 * 1.0.3 made the entire shell a drag region to fix a window that could not be
 * moved. It fixed that and broke everything else: on Windows a drag region eats
 * mouse input, so the slider, the buttons and every control underneath stopped
 * answering. The app looked perfect and did nothing.
 *
 * That is not a mistake to make twice, and it is not one a type checker can see,
 * so it is checked here: the drag region must be a strip, and nothing may put it
 * back on the window.
 *
 *   npm run sim:ui
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const renderer = join(root, 'src/renderer/src')
const main = join(root, 'src/main')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

/** Every rule block in the stylesheet, as { selector, body }. */
function rules(css) {
  const out = []
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = pattern.exec(source)) !== null) {
    out.push({ selector: match[1].trim(), body: match[2] })
  }
  return out
}

/**
 * Source with comments removed.
 *
 * The first version of this file searched raw text and failed on its own
 * documentation — a comment explaining that the social row was removed contains
 * the words "social row". Prose is not behaviour.
 */
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else if (/\.(tsx?|css)$/.test(entry)) files.push(full)
  }
  return files
}

const css = readFileSync(join(renderer, 'index.css'), 'utf8')
const blocks = rules(css)

console.log('\nThe drag region')
const dragRules = blocks.filter((rule) => /-webkit-app-region:\s*drag/.test(rule.body))
const allowed = new Set(['.drag-strip', '.drag'])

check('exists at all', dragRules.length > 0)
for (const rule of dragRules) {
  check(`"${rule.selector}" is a strip, not a surface`, allowed.has(rule.selector), rule.selector)
}

const strip = blocks.find((rule) => rule.selector === '.drag-strip')
check('the strip is bounded in height', Boolean(strip && /height:\s*4\dpx/.test(strip.body)))
check(
  'the strip leaves the window controls clickable',
  Boolean(strip && /right:\s*\d+px/.test(strip.body))
)
check(
  'the strip sits above the screens',
  Boolean(strip && /z-index:\s*\d+/.test(strip.body))
)

/*
 * The strip must not cover a control.
 *
 * It ran from the left edge to 104px from the right, and the back button lives at
 * x20 — inside it — with the settings gear at 86 from the right, also inside it. A
 * drag region eats the pointer, so both were unhoverable and unclickable, while
 * close and minimise worked because they were past the strip's right edge. Numbers,
 * not intentions.
 */
const px = (name) => {
  const match = strip?.body.match(new RegExp(`${name}:\\s*(\\d+)px`))
  return match ? Number(match[1]) : null
}

const stripLeft = px('left') ?? 0
const stripRight = px('right') ?? 0

check('the strip clears the back button', stripLeft >= 72, `${stripLeft}px`)
check('the strip clears the settings gear', stripRight >= 100, `${stripRight}px`)

/* And every control drawn in the top bar says it is not a drag handle. */
const topThumbs = ['components/WindowControls.tsx', 'screens/SignIn.tsx', 'screens/Settings.tsx']
const loose = topThumbs.filter((file) => !/no-drag/.test(code(readFileSync(join(renderer, file), 'utf8'))))
check('top-bar controls are marked no-drag', loose.length === 0, loose.join(', '))

console.log('\nNothing else claims the window')
const offenders = walk(renderer).filter((file) => {
  if (file.endsWith('index.css')) return false
  // A style prop or class that makes anything draggable outside the strip is the
  // same bug wearing a different hat.
  return /appRegion:\s*['"]drag|app-region:\s*drag/.test(code(readFileSync(file, 'utf8')))
})
check('no component makes itself draggable', offenders.length === 0, offenders.map((f) => relative(root, f)).join(', '))

console.log('\nThe library grid')
/*
 * Three squares, one size, one left edge.
 *
 * The cards used to be `flex-1`, so two products produced two wide cards and three
 * produced three narrow ones — the artwork changed size with the length of the
 * catalogue, and a row never lined up twice. The rail is now arithmetic, and the
 * arithmetic is checked here rather than in a screenshot.
 */
const dash = code(readFileSync(join(renderer, 'screens/Dashboard.tsx'), 'utf8'))
const num = (name) => Number((dash.match(new RegExp(`const ${name} = ([\\d.]+)`)) ?? [])[1])

const pageSize = num('PAGE_SIZE')
const card = num('CARD')
const gap = num('GAP')
/* The rail is the expression, not a number — so the expression is what is read. */
const railFits = /const RAIL_WIDTH = PAGE_SIZE \* CARD \+ \(PAGE_SIZE - 1\) \* GAP/.test(dash)
const span = pageSize * card + (pageSize - 1) * gap

check('three to a page', pageSize === 3, String(pageSize))
check('the cards are square and the same size', card > 0 && /style=\{\{ width: CARD \}\}/.test(dash), String(card))
check('the rail is exactly three cards and two gaps', railFits, 'the width is not derived from both')
check('the rail fits inside the window with room for the arrows', span <= 900 - 96, `${span}px of 804`)
check('nothing stretches a card to fill the row', !/min-w-0 flex-1/.test(dash))
check('more than three becomes a page, not a smaller card', /Math\.ceil\(apps\.length \/ PAGE_SIZE\)/.test(dash))

/*
 * The shelf shows artwork and names.
 *
 * A version number and a line of description on a 232px square is two lines of small
 * type where the picture should be; both live in the product's own screen, where they
 * can be read. Asking for one of them back is a design decision, and it should have to
 * be made on purpose rather than creep back in.
 */
const shelf = code(readFileSync(join(renderer, 'components/Card.tsx'), 'utf8'))
check('the card carries no version', !/app\.version/.test(shelf))
check('the card carries no description', !/app\.description/.test(shelf))
check('the artwork fills the card', /absolute inset-0/.test(shelf) && !/h-\[128px\]/.test(shelf))
check('the library is called Browse library', /Browse library/.test(dash))
check('and the library has no corner label', !/Indra Loader/i.test(dash) && !/\{username\}/.test(dash))

console.log('\nThe product screen')
/*
 * No version, and no sheet.
 *
 * The detail overlay used to paint the app's own background over the window, which is
 * the one place the film visibly stopped. It also carried a version pill and a version
 * row in a table — the same number twice, on a screen where it can only change when an
 * update arrives.
 */
const detail = code(readFileSync(join(renderer, 'screens/AppDetail.tsx'), 'utf8'))
check('the detail screen carries no version', !/app\.version/.test(detail))

/*
 * The arrangement, which was five hand-kept coordinates that had drifted apart — a
 * name above a void, a status line too dim to read, and two buttons of different
 * sizes stopping a few pixels past the text column. A grid cannot drift: every edge
 * is another edge's business.
 */
check('the artwork and the text are one centred row', /items-center justify-center/.test(detail))
check('the column is at least as tall as the artwork', /minHeight: ART/.test(detail))
check('the actions sit at the foot of that column', /mt-auto/.test(detail))
check(
  'the two actions are the same width',
  (detail.match(/flex-1/g) ?? []).length >= 2 && !/width: (312|180)/.test(detail)
)
check(
  'the circles share the artwork gutter',
  /left=\{28\}/.test(detail) && /left=\{834\}/.test(detail)
)
check('and does not paint over the film', !/bg-\[var\(--color-bg\)\]/.test(detail))

/*
 * Downloaded once, and never twice.
 *
 * The Download button used to exist whether or not the file did — and on a restart the
 * loader forgot what it had, because the state came from an in-memory map that starts
 * empty. Both are checked here and in sim:download, from the disk.
 */
check('the download button is rendered once, for the not-downloaded case', (detail.match(/onClick=\{onDownload\}/g) ?? []).length === 1)
check('the installed state offers launch instead', /installed \? \([\s\S]{0,1200}onLaunch/.test(detail))
check('and says so in the status line', /Downloaded/.test(detail))

const service = code(readFileSync(join(main, 'services/downloads.ts'), 'utf8'))
const registry = code(readFileSync(join(main, 'services/installed.ts'), 'utf8'))

check('the screens read the disk, not a memory of it', /for \(const entry of allInstalled\(\)\)/.test(service))
check('a restart cannot forget a download', /readRegistry\(\)/.test(service))
check('an existing file is never fetched again', /const already = installed\(id\)/.test(service))
check('a truncated file counts as missing', /info\.size !== entry\.bytes/.test(registry))
check('the library lives in the loader folder', /libraryDir\(app\.getPath\('userData'\)\)/.test(registry))

console.log('\nThe connecting screen')
/*
 * It became a way to lose the app.
 *
 * The remembered-session effect cancelled itself — `setScreen('verifying')` changed a
 * dependency, React ran the cleanup, and the continuation that opens the library saw
 * `cancelled` and returned. The spinner ran forever, and it painted nothing behind
 * itself, so the window looked like somebody else's half-drawn screen.
 */
const shell = code(readFileSync(join(renderer, 'App.tsx'), 'utf8'))
const verifying = code(readFileSync(join(renderer, 'screens/Verifying.tsx'), 'utf8'))

check('the restore sequence cannot cancel itself', !/let cancelled/.test(shell))
check('the sign-in form is the first screen after the splash', /screen === 'signin'/.test(shell))
check('a hung sign-in is capped', /withCap\(bridge\.auth\.login/.test(shell))
check('a hung sign-in cannot hang twice over', (shell.match(/withCap\(/g) ?? []).length >= 1)
check('a failed sign-in returns to the form', /\.catch\(\(error: unknown\)/.test(shell))
check('the spinner covers what is behind it', /bg-\[var\(--color-bg\)\]/.test(verifying))
check('and after a while it offers a way back', /Back to sign in/.test(verifying))

/*
 * The sign-in screen is not the updater's to remove.
 *
 * Restoring a remembered session on every launch silently took the form out of the
 * app — the window opened straight into the library with no way to sign in, sign out,
 * or be somebody else. It is now used on exactly one launch: the one the updater
 * started, which is the only launch that has to be invisible.
 */
check('the app never opens the library on its own', !/auth\.restore/.test(shell))
check('and an update restart announces itself', /Updated to/.test(shell))
check(
  'and the form is reachable again afterwards',
  /Sign out/.test(code(readFileSync(join(renderer, 'screens/Settings.tsx'), 'utf8')))
)

console.log('\nThe settings screen')
/*
 * A rail and a page, not a pile of cards.
 *
 * Every section used to be its own bordered box, which is fine for two sections and
 * unmaintainable at ten: each box had its own padding and its own idea of where a
 * button goes, and one of them managed to wrap a two-word label onto two lines. Rows
 * cannot do that — a row is a label, a value, a hairline.
 */
const settings = code(readFileSync(join(renderer, 'screens/Settings.tsx'), 'utf8'))
check('the sections live in a rail', /aria-label="Settings sections"/.test(settings))
check(
  'four sections to start with',
  (settings.match(/\{ id: '(updates|account|about|links)'/g) ?? []).length === 4
)
check('no bordered cards left on the screen', !/bg-\[var\(--color-surface\)\]/.test(settings))
check('a button label never wraps', /whitespace-nowrap/.test(settings))
check(
  'the access checker is gone from settings',
  !/Check access/.test(settings) && !/auth\.probe/.test(settings)
)

console.log('\nThe landing page')
const landing = code(readFileSync(join(renderer, 'screens/Landing.tsx'), 'utf8'))
check('has no social row', !/FOLLOW US|Follow us|instagram-icon|SocialMark/i.test(landing))
check('reaches the website through one button', /Website/.test(landing))

const anywhere = walk(renderer).filter((file) => /instagram|tiktok|discord/i.test(code(readFileSync(file, 'utf8'))))
check('the app mentions no social channel', anywhere.length === 0, anywhere.map((f) => relative(root, f)).join(', '))

console.log('\nThe splash')
const app = code(readFileSync(join(renderer, 'App.tsx'), 'utf8'))
const splash = app.match(/SPLASH_MS\s*=\s*([\d_]+)/)
check('is two seconds, not four', Boolean(splash && Number(splash[1].replace(/_/g, '')) === 2000), splash?.[1])

console.log(
  failures === 0
    ? '\n✓ The window drags from its strip, and nothing is swallowing clicks.\n'
    : `\n✗ ${failures} check(s) failed.\n`
)
process.exitCode = failures === 0 ? 0 : 1
