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
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { build } from 'esbuild'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const renderer = join(root, 'src/renderer/src')
const main = join(root, 'src/main')
const work = join(tmpdir(), 'indra-loader-ui-sim')
mkdirSync(work, { recursive: true })

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

const visible = num('VISIBLE')
const card = num('CARD')
const gap = num('GAP')
/** The rail is the expression, not a number — so the expression is what is read. */
const railFits = /const RAIL_WIDTH = VISIBLE \* CARD \+ \(VISIBLE - 1\) \* GAP/.test(dash)
const span = visible * card + (visible - 1) * gap

check('three in view', visible === 3, String(visible))
check('the cards are one fixed size', card > 0 && /style=\{\{ width: CARD \}\}/.test(dash), String(card))
check('the window is exactly three cards and two gaps', railFits, 'the width is not derived from both')
check('it fits inside the window with room for the arrows', span <= 900 - 96, `${span}px of 804`)
check('nothing stretches a card to fill the row', !/min-w-0 flex-1/.test(dash))

/*
 * The carousel.
 *
 * It used to page: three cards mounted, the next three mounted in their place with a
 * 300ms slide over the top. The old cards were gone at the instant the new ones started
 * arriving, so what you saw was a cut with a wipe on it — "it just redirects".
 *
 * Now every card is on one track and a move is a translation of that track. These
 * checks are about that difference, because it is the whole feature: the cards you were
 * looking at are the cards sliding away.
 */
check('every card is mounted on one track', /apps\.map\(\(app\) =>/.test(dash))
check('and a move never slices the catalogue', !/apps\.slice\(/.test(dash))
check('one move is one card and one gap', /const STEP = CARD \+ GAP/.test(dash))
check('the track rests at a card boundary', /-value \* STEP/.test(dash))
check(
  'and it travels rather than jumps',
  /translate3d\(\$\{resting \+ drag\}px, 0, 0\)/.test(dash) &&
    /transition: transform 620ms cubic-bezier\(0\.22, 0\.61, 0\.36, 1\)/.test(readFileSync(join(renderer, 'index.css'), 'utf8'))
)
check('a drag is followed under the pointer, not chased', /transition: none/.test(readFileSync(join(renderer, 'index.css'), 'utf8')))
check('a throw carries its speed', /THROW_MS/.test(dash) && /velocity \* THROW_MS/.test(dash))
check('the ends resist instead of opening onto nothing', /dx \* 0\.32/.test(dash))
check('a drag is not a click', /CLICK_SLOP/.test(dash) && /stopPropagation\(\)/.test(dash))
/*
 * A press must not become a drag on contact.
 *
 * 1.0.46 captured the pointer and entered the dragging state the moment a card was
 * pressed. Both of those take the press away from the card: capture retargets the events
 * to the strip, and the dragging styles turn card hit-testing off — so the card never
 * received the click that ended the press, and no card could be opened. Contact now does
 * nothing; the strip commits on the first move past the slop.
 */
const pressHandler = dash.slice(dash.indexOf('const onPointerDown'), dash.indexOf('const onPointerMove'))
check('a press does not capture the pointer', !/setPointerCapture/.test(pressHandler))
check('a press does not enter the dragging state', !/setDragging\(true\)/.test(pressHandler))
check(
  'the strip commits only once it has moved',
  /if \(!dragged\.current\) \{[\s\S]{0,120}?Math\.abs\(dx\) <= CLICK_SLOP\) return[\s\S]{0,400}?setPointerCapture/.test(dash)
)
check('and a press that never moved settles nothing', /if \(!dragged\.current\) \{\s*setDragging\(false\)/.test(dash))
check('the wheel moves it', /onWheel/.test(dash) && /WHEEL_STEP/.test(dash))
check('the keyboard moves it', /event\.key === 'ArrowRight'/.test(dash) && /event\.key === 'End'/.test(dash))
check('and typing is never stolen from a field', /INPUT\|TEXTAREA\|SELECT/.test(dash))
check('the dots go to a position, not a page number', /onClick=\{\(\) => move\(position\)\}/.test(dash))
check('reduced motion keeps it still but working', /prefers-reduced-motion: reduce\) \{\s*\.card-track \{\s*transition: none/.test(readFileSync(join(renderer, 'index.css'), 'utf8')))

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

/*
 * The film, and the bar.
 *
 * `loop` is one attribute and one visible freeze per playthrough on a large file: it
 * seeks to zero. The standby layer is the fix, and it only stays fixed if nobody puts
 * `loop` back. The progress readout is the other half — 0% with bytes arriving is
 * indistinguishable from a stalled download.
 */
const backdrop = code(readFileSync(join(renderer, 'components/Backdrop.tsx'), 'utf8'))
check('the film loops by handover, not by seeking', !/\bloop\b/.test(backdrop.replace(/`[^`]*`/g, '')))
check('two layers, so the join is a fade', (backdrop.match(/<video/g) ?? []).length === 2)
check('and it is memoised, so a download cannot re-render it', /export default memo\(Backdrop\)/.test(backdrop))

/*
 * Blur and dim are published by the panel, not baked into a build.
 *
 * The film is assigned to a person who can see it and we cannot, so the app takes two
 * numbers from the catalogue and applies them directly: pixels of blur on the video,
 * a plain dark rectangle over it. The scale is the part that is easy to forget — a
 * blurred rectangle inside a sharp border reads as a bug, so the picture grows by as
 * much as it softens.
 */
const backdropCss = code(readFileSync(join(renderer, 'index.css'), 'utf8'))
check('the film takes its blur from the panel', /filter: blur\(var\(--film-blur/.test(backdropCss))
check('and grows by as much as it softens', /transform: scale\(var\(--film-scale/.test(backdropCss))
check('the darkening is its own layer, above the film', /\.backdrop \.film-dim/.test(backdropCss))
check('the scrim survives the wash rules', /border-radius: 0;/.test(backdropCss) && /filter: none;/.test(backdropCss))
const backdropStage = code(readFileSync(join(renderer, 'App.tsx'), 'utf8'))
/*
 * The same two dials, per card.
 *
 * One loud poster should not force the rest of the shelf to change, so blur and dim ride
 * on the product row rather than the config. The name over the artwork is deliberately
 * *not* filtered: a `brightness()` would take the name down with the picture, and the name
 * is the one thing on a card that has to stay white.
 */
const cardComponent = code(readFileSync(join(renderer, 'components/Card.tsx'), 'utf8'))
check('a card takes its frame from its own row', /blur=\{app\.artworkBlur\}/.test(cardComponent) && /dim=\{app\.artworkDim\}/.test(cardComponent))
const monogramFrame = code(readFileSync(join(renderer, 'components/Monogram.tsx'), 'utf8'))
check('the softening grows the picture, so no edge shows', /const scale = 1 \+ Math\.min\(0\.16, blur \/ 100\)/.test(monogramFrame))
check('the darkening is a layer, not a filter on the name', /background: '#060608', opacity: dim \/ 100/.test(monogramFrame))
check('a card without a frame renders exactly as before', /const frame = blur/.test(monogramFrame))

check(
  'the renderer passes both numbers to the backdrop',
  /blur=\{config\.filmBlur\}/.test(backdropStage) && /dim=\{config\.filmDim\}/.test(backdropStage)
)

check('no length means bytes on screen, not a frozen 0%', /metered \? `\$\{percent\}%` : `\$\{megabytes\} MB`/.test(detail))
check('the stripe moves when the length is unknown', /download-stripe/.test(readFileSync(join(renderer, 'index.css'), 'utf8')))
check('a stall is detected rather than waited on', /STALL_MS/.test(service))
check('and the transfer is continued, not restarted', /resumeFrom: resumableBytes\(target\.exe\)/.test(service))

/*
 * A fixed response cannot reach a cache written before the fix.
 *
 * 1.0.27 will have the old film cached for a day — a copy with no length, which cannot
 * seek and therefore cannot loop. The cache is dropped once per version, before the
 * window exists, or the update would appear to have changed nothing.
 */
const cache = code(readFileSync(join(main, 'lib/cache-version.ts'), 'utf8'))
const entry = code(readFileSync(join(main, 'index.ts'), 'utf8'))
check('an old cache is dropped on the first start of a new version', /previous\(\) === current\) return/.test(cache))
check('and it is dropped before anything is fetched', /await clearCacheOnUpdate\(\)/.test(entry))

/*
 * The film starts with the window, not after it.
 *
 * It used to be: catalogue round trip → bucket → first frame, every launch. Now the
 * backdrop asks the process for a local file at mount, and the published address is only
 * the fallback for the one launch that has never had one.
 */
const appShell = code(readFileSync(join(renderer, 'App.tsx'), 'utf8'))
const filmCache = code(readFileSync(join(main, 'lib/film.ts'), 'utf8'))
check('the backdrop asks for the film before fetching anything', /bridge\.media\s*\.\s*film\(\)/.test(appShell))
check('the cached source wins over the published address', /video=\{film \|\| config\.video/.test(appShell))
check('the film is served from disk, not the network', /protocol\.handle\(SCHEME/.test(filmCache))
check('and it is fetched once, for next time', /export function ensureFilm/.test(filmCache))
check('an old film is not kept forever', /const KEEP = 2/.test(filmCache))
check('the scheme is allowed by the policy', /media-src 'self' blob: https: indra-film:/.test(readFileSync(join(main, 'index.ts'), 'utf8')))

/* ------------------------------------------------------- the description ---- */

/*
 * People write a description the way they write a message: a claim, then features
 * separated by hyphens. Printed raw it is a wall of capitals that wraps in the wrong
 * places, which is what it looked like. This checks the parse, not the string.
 */
console.log('\nA description, parsed the way it is drawn')

const proseFile = join(work, 'prose.mjs')
await build({
  entryPoints: [join(renderer, 'lib/prose.ts')],
  outfile: proseFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent'
})
const prose = await import(`file://${proseFile}?t=${Date.now()}`)

const shout = prose.parseDescription(
  'BEST EXTERNAL CHEATS IN THE MARKET…! MANY COOL FEATURES :-AIMBOT ( EXTERNAL , AI , RAGE )-ESP MENU-EXTRA FEATURES-SKIN CHANGER'
)
check('the claim becomes a sentence', shout.about === 'Best external cheats in the market…! Many cool features', shout.about)
check('the run becomes four features', shout.features.length === 4, JSON.stringify(shout.features))
check('one line, one honest feature', shout.features[3] === 'Skin changer', shout.features[3])
check('acronyms keep their capitals', shout.features[0] === 'Aimbot (external, AI, rage)', shout.features[0])
check('a name keeps its hyphen', prose.parseDescription('Anti-Aim and Fake Lag built in').features.length === 0)
check('plain prose stays a paragraph', prose.parseDescription('External cheat for the season.').features.length === 0)

const detailScreen = code(readFileSync(join(renderer, 'screens/AppDetail.tsx'), 'utf8'))
check('the screen draws the parsed form', /parseDescription\(app\.description\)/.test(detailScreen))
check('features are a list, not a paragraph', /aria-label="Features"/.test(detailScreen))
check('a very long list is capped', /prose\.features\.slice\(0, 6\)/.test(detailScreen))

/* ------------------------------------------------------------- artwork ---- */

/*
 * The library is a grid of pictures, and each one used to start downloading when its card
 * mounted — art arriving behind the names, one card at a time. Asking for all of them the
 * moment the catalogue is known is what makes the grid paint whole.
 */
const monogram = code(readFileSync(join(renderer, 'components/Monogram.tsx'), 'utf8'))
check('artwork is warmed when the catalogue arrives', /warmImages\(catalogue\.apps\)/.test(appShell))

/*
 * The four seconds after a sign-in.
 *
 * The library used to open on a grid that was still assembling itself. Now it is mounted
 * under a curtain, at zero opacity, and given four and a half seconds: images decode,
 * clips land in the cache and start looping, and the curtain lifts onto a finished
 * screen. Opacity rather than `display: none` is the whole mechanism — a hidden element
 * still paints.
 */
check('the reveal is held, not instant', /PREPARE_MS = 4_500/.test(appShell))
check('the grid is not mounted under the curtain', /curtain !== 'preparing'/.test(appShell))
check('the grid fades in as the curtain lifts', /\.library-stage \{/.test(readFileSync(join(renderer, 'index.css'), 'utf8')))
check('a clip is fetched into the cache, not just started', /fetch\(app\.image, \{ cache: 'force-cache' \}\)/.test(appShell))
check('one warm per address, ever', /const warmed = new Set/.test(appShell))
check('the curtain fades rather than cutting', /\.curtain\[data-out='true'\]/.test(readFileSync(join(renderer, 'index.css'), 'utf8')))

/*
 * A spinner that visibly turns.
 *
 * The first one was a border with one edge tinted: a quarter of a hairline, repainted on
 * the main thread every frame, on top of a backdrop-blurred playing video. On a machine
 * decoding three card videos that is a still picture — which is exactly what it looked
 * like. It is an SVG arc now, composited, and the curtain behind it is flat black so
 * there is nothing to re-blur.
 */
const spinner = code(readFileSync(join(renderer, 'components/Spinner.tsx'), 'utf8'))
check('the circle is an arc, not a border', /<svg/.test(spinner) && /strokeDasharray/.test(spinner))
check('and it turns on the compositor', /\.spinner \{[^}]*animation: spin 1s linear infinite/.test(readFileSync(join(renderer, 'index.css'), 'utf8')))
const curtainCss = readFileSync(join(renderer, 'index.css'), 'utf8')
check('the curtain has nothing to re-blur', !/backdrop-filter\s*:/.test(curtainCss.split('.curtain {')[1].split('}')[0]))
check('the film still plays behind the curtain', /radial-gradient\(62% 58% at 50% 46%/.test(curtainCss))
check('the mark is only a circle', !/curtain-rule|curtain-halo/.test(curtainCss))


/*
 * One loading, not two.
 *
 * The app used to show a verifying spinner for the login and then the curtain for the
 * library: the same circle twice with a change of scenery in between, which anybody
 * watching reads as one long stall. There is one screen now, it goes up on the press of
 * Sign in, and it comes down once.
 */
/*
 * Windows checks out these files with CRLF, so anything anchored on a line break has to
 * say `\r?` or it passes here and fails on the only machine that ships the app.
 */
check(
  'signing in raises the curtain, not a second screen',
  /setScreen\('home'\)\r?\n\s*setCurtain\('preparing'\)/.test(appShell)
)
check('there is no second loading screen left in the app', !/verifying/.test(appShell.replace(/\/\*[\s\S]*?\*\//g, '')))
check('and the login happens under it', /await withCap\(bridge\.auth\.login[\s\S]{0,400}?loadLibrary\(\)/.test(appShell))
check(
  'the clock starts at the press, not at the login',
  appShell.indexOf('const opened = Date.now()') > 0 &&
    appShell.indexOf('const opened = Date.now()') < appShell.indexOf('withCap(bridge.auth.login')
)
check('a stale attempt cannot open the library', /attempt\.current === run/.test(appShell))
check('a broken wait says so, once', /STALL_AFTER_MS = 12_000/.test(appShell) && /Still connecting/.test(readFileSync(join(renderer, 'screens/Preparing.tsx'), 'utf8')))
check('waiting for artwork has a ceiling', /ARTWORK_CEILING_MS/.test(appShell))
check('images are decoded, not merely downloaded', /\.decode\(\)/.test(appShell))
check('the film keeps playing under the curtain', !/paused=/.test(appShell) && !/paused\?:/.test(backdrop))
check('and only the front layer is resumed', /layers\[front\]/.test(backdrop))

/*
 * The spinner that never turned.
 *
 * The app has a blanket reduced-motion rule — correct, and it takes every animation down
 * to one 1ms iteration. Which is a frozen interface for anyone whose Windows has
 * "animation effects" switched off, and indistinguishable from a hung app. A spinner is
 * information, not decoration, so it is the one thing exempted.
 */
const appCss = readFileSync(join(renderer, 'index.css'), 'utf8')
const reduceBlock = appCss.slice(appCss.indexOf('@media (prefers-reduced-motion: reduce)'))
check('a still machine still gets a turning circle', /\.spinner \{\s*animation-duration: 1s !important/.test(reduceBlock))
check('the washes are not left mounted behind a film', /showVideo \? null :/.test(backdrop))
check('and Settings names the reason when motion is held still', /Reduced — the system asked/.test(readFileSync(join(renderer, 'screens/Settings.tsx'), 'utf8')))
check('every card is asked for, not just the visible ones', /new Image\(\)/.test(appShell))
check('a big picture never blocks the paint', /decoding="async"/.test(monogram))
check('and a GIF is left to animate', !/imageRendering|freeze|poster/.test(monogram))

/*
 * A card can be a short loop.
 *
 * The same idea as a GIF with a tenth of the bytes, and the card is the only place it
 * shows — so it has to be a muted, inline, self-starting video, or Windows will refuse to
 * play it and the card will sit there black.
 */
check('a video card renders as a video', /isMovingArtwork\(image\) \?/.test(monogram))
check('it starts without a click', /autoPlay/.test(monogram) && /muted/.test(monogram))
check('and loops quietly', /loop/.test(monogram) && !/controls/.test(monogram))
check('warmed by playing, not by fetching twice', /mp4\|webm/.test(appShell))

/*
 * Artwork that cannot be drawn is worse than no artwork: a black rectangle in a grid of
 * working cards reads as a broken app. Both paths fall back to the wash and the initial.
 */
check('a picture that fails falls back to the wash', /if \(usable\)/.test(monogram) && /onError=\{\(\) => setFailed\(true\)\}/.test(monogram))
check('and so does a video', (monogram.match(/onError/g) ?? []).length === 2)

/* ------------------------------------------------------------ video, fast -- */

/*
 * Every screen here is a video surface. When Chromium falls back to decoding on the
 * processor there is no amount of app code that makes 1080p smooth — so the app asks for
 * the graphics card, and then says what it got, in Settings, instead of leaving it to be
 * guessed at from a screenshot.
 */
const entrySource = code(readFileSync(join(main, 'index.ts'), 'utf8'))
check('the blocklist is not allowed to decide', /ignore-gpu-blocklist/.test(entrySource))
check('hardware video decode is requested', /enable-accelerated-video-decode/.test(entrySource))
check('the answer is available, not assumed', /getGPUFeatureStatus/.test(readFileSync(join(main, 'ipc/index.ts'), 'utf8')))
const settingsForVideo = code(readFileSync(join(renderer, 'screens/Settings.tsx'), 'utf8'))
check('and Settings reports it', /Video decode/.test(settingsForVideo))
check('with a measured frame rate beside it', /Frame rate/.test(settingsForVideo) && /requestAnimationFrame/.test(settingsForVideo))

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
const curtainScreen = code(readFileSync(join(renderer, 'screens/Preparing.tsx'), 'utf8'))

check('the restore sequence cannot cancel itself', !/let cancelled/.test(shell))
check('the sign-in form is the first screen after the splash', /screen === 'signin'/.test(shell))
check('a hung sign-in is capped', /withCap\(bridge\.auth\.login/.test(shell))
check('a hung sign-in cannot hang twice over', (shell.match(/withCap\(/g) ?? []).length >= 1)
check('a failed sign-in returns to the form', /\.catch\(\(error: unknown\)/.test(shell))
check('the curtain covers what is behind it', /\.curtain \{/.test(readFileSync(join(renderer, 'index.css'), 'utf8')))
check('and after a while it offers a way back', /Back to sign in/.test(curtainScreen))

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
