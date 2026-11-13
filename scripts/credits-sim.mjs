/**
 * The credit console.
 *
 * Credits are meant to pay for more than one feature, so the thing that has to
 * be true is that nothing about their price lives in the app: the currency, its
 * symbol and its decimals, what a credit buys, what a tier costs, what a pack
 * costs and what the limits are all come from the server and can be changed
 * from the administrator's console. This file checks that, and it checks the
 * arithmetic that turns typed money into the integer the server stores.
 *
 *   npm run sim:credits
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-credits-sim')

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

  /* ---------------- the money rules ---------------- */

  const bundle = join(work, 'money.cjs')
  await build({
    entryPoints: [join(root, 'src/renderer/src/lib/money.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    logLevel: 'warning',
    alias: { '@shared': join(root, 'src/shared') }
  })
  const { money, minorFrom, minorToText, shapeFor, tokens } = await import(
    `file://${bundle}?t=${Date.now()}`
  ).then((module) => module.default)

  const usd = { currency: 'USD', symbol: '$', decimals: 2 }
  const npr = { currency: 'NPR', symbol: 'Rs', decimals: 2 }
  const jpy = { currency: 'JPY', symbol: '¥', decimals: 0 }

  check(money(399, usd) === '$3.99', 'a minor price draws with two decimals', money(399, usd))
  check(money(0, usd) === 'Free', 'zero is a gift, not $0.00', money(0, usd))
  check(money(199900, usd) === '$1,999.00', 'thousands are grouped', money(199900, usd))
  check(money(5, usd) === '$0.05', 'a single minor unit is one cent', money(5, usd))
  check(money(129900, jpy) === '¥129,900', 'a zero-decimal currency shows no point', money(129900, jpy))
  check(money(129900, npr) === 'Rs1,299.00', 'a different currency uses its own symbol', money(129900, npr))
  check(money(399, null) === '$3.99', 'with no settings read yet, dollars are assumed', money(399, null))
  check(money(null, usd) === '—', 'no price is an em dash, never zero', money(null, usd))

  /* A receipt keeps the currency it was quoted in. */
  check(
    money(399, shapeFor('INR', usd)) === '₹399',
    'an old rupee receipt is not reprinted as dollars',
    money(399, shapeFor('INR', usd))
  )
  check(
    money(399, shapeFor('USD', usd)) === '$3.99',
    'a receipt in the current currency follows the workspace settings'
  )
  check(
    money(1000, shapeFor('XYZ', null)) === 'XYZ 10.00',
    'an unknown currency still says which one it is',
    money(1000, shapeFor('XYZ', null))
  )

  /* ---------------- typing a price ---------------- */

  check(minorFrom('3.99', 2) === 399, '3.99 is 399 cents', String(minorFrom('3.99', 2)))
  check(minorFrom('3', 2) === 300, '3 is three hundred cents', String(minorFrom('3', 2)))
  check(minorFrom('3.9', 2) === 390, '3.9 pads to 390', String(minorFrom('3.9', 2)))
  check(minorFrom('$3.99', 2) === 399, 'a pasted symbol is ignored', String(minorFrom('$3.99', 2)))
  check(minorFrom('1,299.00', 2) === 129900, 'a thousands separator is ignored', String(minorFrom('1,299.00', 2)))
  check(minorFrom('3.999', 2) === null, 'more decimals than the currency has is refused')
  check(minorFrom('abc', 2) === null, 'words are not a price')
  check(minorFrom('', 2) === null, 'an empty field is not zero')
  check(minorFrom('-1.50', 2) === 150, 'a pasted minus sign is dropped, not applied', String(minorFrom('-1.50', 2)))
  check(minorFrom('1.5', 0) === null, 'a currency without decimals refuses a point', String(minorFrom('1.5', 0)))
  check(minorToText(399, 2) === '3.99', '399 turns back into 3.99', minorToText(399, 2))
  check(minorToText(300, 2) === '3.00', 'a whole amount keeps its decimals', minorToText(300, 2))
  check(minorToText(129900, 0) === '129900', 'a zero-decimal currency turns back exactly')
  check(tokens(2500) === '2,500', 'tokens are grouped whole numbers', tokens(2500))

  /* ---------------- the service reads the rules defensively ---------------- */

  /* The service module imports Electron, which does not exist outside the app;
     a stand-in with the one member it touches is enough to load it. */
  mkdirSync(join(work, 'node_modules', 'electron'), { recursive: true })
  writeFileSync(
    join(work, 'node_modules', 'electron', 'package.json'),
    JSON.stringify({ name: 'electron', version: '45.0.0', main: 'index.js' })
  )
  writeFileSync(
    join(work, 'node_modules', 'electron', 'index.js'),
    'module.exports = { net: {}, app: { getPath: () => "", getVersion: () => "0.0.0" }, safeStorage: {} }\n'
  )

  const serviceBundle = join(work, 'service.cjs')
  await build({
    entryPoints: [join(root, 'src/main/services/ai.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'node:sqlite'],
    outfile: serviceBundle,
    logLevel: 'warning'
  })
  const service = await import(`file://${serviceBundle}?t=${Date.now()}`).then((module) => module.default)

  const fromServer = service.asTokenSettings({
    currency: 'npr',
    symbol: 'Rs',
    decimals: 2,
    topupTokens: 250,
    topupPriceMinor: 49900,
    minTopup: 50,
    maxTopup: 5000,
    lowBalance: 40,
    updatedAt: '2026-01-01T00:00:00Z'
  })
  check(fromServer.currency === 'NPR', 'a lowercase currency code is normalised')
  check(fromServer.topupTokens === 250, 'the rules are carried through')
  check(money(fromServer.topupPriceMinor, fromServer) === 'Rs499.00', 'a pack price draws in its own currency', money(fromServer.topupPriceMinor, fromServer))

  const empty = service.asTokenSettings({})
  check(
    empty.currency === 'USD' && empty.symbol === '$' && empty.decimals === 2,
    'a row with nothing in it falls back to dollars, never to blank'
  )
  check(
    empty.topupTokens === 100_000 && empty.topupPriceMinor === 10_000 && empty.minTopup === 100_000,
    'the fallbacks match what the database ships'
  )
  check(service.asTokenSettings(null) === null, 'no rules at all is null, not a zeroed price')

  const nonsense = service.asTokenSettings({
    currency: 'dollars',
    decimals: 9,
    topupTokens: 0,
    topupPriceMinor: 'lots'
  })
  check(nonsense.currency === 'USD', 'a currency that is not a code is refused')
  check(nonsense.decimals === 3, 'decimals are clamped to something a price can use', String(nonsense.decimals))
  check(nonsense.topupTokens === 1 && nonsense.topupPriceMinor === 10_000, 'impossible pack numbers fall back')

  /* ---------------- what one credit costs ---------------- */

  const perCredit = fromServer.topupPriceMinor / fromServer.topupTokens
  check(perCredit === 199.6, 'the per-credit price comes from the pack, not a constant', String(perCredit))

  /* ---------------- the palette has no fourth colour ---------------- */

  /*
   * The product is black, dark grey and white, and that is a rule the owner has
   * had to repeat. It is cheap to break by accident — one warm accent value in
   * a theme file puts colour on every primary button and every focus ring — so
   * the rule is a check rather than a habit. Any hex in the stylesheets whose
   * channel spread exceeds a hair of anti-alias allowance is a colour, and a
   * colour here is a bug.
   */
  const cssFiles = ['index.css', 'workspace.css', 'document.css', 'design.css']
  const colourful = []
  for (const name of cssFiles) {
    const css = readFileSync(join(root, 'src/renderer/src/styles', name), 'utf8')
    for (const match of css.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
      const hex = match[1]
      const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16))
      if (Math.max(r, g, b) - Math.min(r, g, b) > 14) {
        colourful.push(`${name}#${hex}`)
      }
    }
    if (/hsl\(|rgb\(/.test(css)) colourful.push(`${name}: a computed colour`)
  }
  check(
    colourful.length === 0,
    'the stylesheets carry no colour, only greys',
    colourful.slice(0, 6).join(', ')
  )

  /*
   * And the one theme whose accent is light (the dark one) must not put white
   * text on it: that is a button that disappears, not a colour rule. Every
   * theme's accent is checked against the ink it puts on top of it.
   */
  const css = readFileSync(join(root, 'src/renderer/src/styles/index.css'), 'utf8')
  // Any `{ ... }` block, comments and all: the strict selector class this
  // used before silently matched nothing, so the check passed over an
  // empty list — a guard that verified nothing at all.
  const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\{([^{}]*)\}/g)].map((m) => m[1])
  const unreadable = []
  for (const body of blocks) {
    // `\\s` in the source is one backslash in the pattern; four would look for a
    // literal "s". No "g" flag either: with it `match` returns whole strings,
    // every capture is undefined, and this guard passes over anything.
    const read = (name) => body.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`))?.[1]
    const accent = read('accent')
    const ink = read('accent-ink')
    if (!accent || !ink) continue
    const luminance = (hex) => {
      const channels = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
      const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }
    const [light, dark] = [luminance(accent), luminance(ink)].sort((a, b) => b - a)
    const ratio = (light + 0.05) / (dark + 0.05)
    if (ratio < 4.5) unreadable.push(`#${accent} on #${ink} = ${ratio.toFixed(2)}:1`)
  }
  check(unreadable.length === 0, 'every accent is readable under its own label', unreadable.join(', '))

  console.log(
    failures === 0
      ? '\n✓ prices are settings, money is integer, and a receipt keeps its currency'
      : `\n${failures} check(s) failed`
  )
  if (failures > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
})
