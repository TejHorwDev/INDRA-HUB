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
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
  const { money, minorFrom, minorToText, shapeFor, credits } = await import(
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
  check(credits(2500) === '2,500', 'credits are grouped whole numbers', credits(2500))

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

  const fromServer = service.asCreditSettings({
    currency: 'npr',
    symbol: 'Rs',
    decimals: 2,
    tokensPerCredit: 750,
    topupCredits: 250,
    topupPriceMinor: 49900,
    minTopup: 50,
    maxTopup: 5000,
    lowBalance: 40,
    updatedAt: '2026-01-01T00:00:00Z'
  })
  check(fromServer.currency === 'NPR', 'a lowercase currency code is normalised')
  check(fromServer.tokensPerCredit === 750 && fromServer.topupCredits === 250, 'the rules are carried through')
  check(money(fromServer.topupPriceMinor, fromServer) === 'Rs499.00', 'a pack price draws in its own currency', money(fromServer.topupPriceMinor, fromServer))

  const empty = service.asCreditSettings({})
  check(
    empty.currency === 'USD' && empty.symbol === '$' && empty.decimals === 2,
    'a row with nothing in it falls back to dollars, never to blank'
  )
  check(
    empty.tokensPerCredit === 1000 && empty.topupCredits === 100 && empty.topupPriceMinor === 199,
    'the fallbacks match what the database ships'
  )
  check(service.asCreditSettings(null) === null, 'no rules at all is null, not a zeroed price')

  const nonsense = service.asCreditSettings({
    currency: 'dollars',
    decimals: 9,
    tokensPerCredit: -4,
    topupCredits: 0,
    topupPriceMinor: 'lots'
  })
  check(nonsense.currency === 'USD', 'a currency that is not a code is refused')
  check(nonsense.decimals === 3, 'decimals are clamped to something a price can use', String(nonsense.decimals))
  check(nonsense.tokensPerCredit === 1, 'a credit always buys at least one token', String(nonsense.tokensPerCredit))
  check(nonsense.topupCredits === 1 && nonsense.topupPriceMinor === 199, 'impossible pack numbers fall back')

  /* ---------------- what one credit costs ---------------- */

  const perCredit = fromServer.topupPriceMinor / fromServer.topupCredits
  check(perCredit === 199.6, 'the per-credit price comes from the pack, not a constant', String(perCredit))

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
