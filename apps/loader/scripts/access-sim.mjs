/**
 * Who owns what, checked against every shape an API might answer with.
 *
 * The loader cannot know `GET /v1/apps`'s response shape, so it reads the answer
 * structurally. That makes the parser the load-bearing part of entitlement: if it
 * misses a wrapper, a paying customer sees "locked" and there is nothing in the UI
 * to explain why.
 *
 *   npm run sim:access
 */
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(root, '.sim')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

async function bundle(entry, name) {
  const outfile = join(work, `${name}.mjs`)
  await build({
    entryPoints: [join(root, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

const same = (actual, expected) =>
  actual.length === expected.length && expected.every((value) => actual.includes(value))

async function main() {
  const { parseOwned } = await bundle('src/main/lib/owned.ts', 'owned')
  const access = await bundle('src/shared/access.ts', 'access')

  const ID = 'f2bfc9baa7c99b90c0d6974b'
  const NAME = 'External Max'

  console.log('\nResponse shapes')
  check('an array of ids', same(parseOwned([ID, 'abc']), [ID, 'abc']))
  check('an array of objects with id', same(parseOwned([{ id: ID }]), [ID]))
  check('an array of objects with app_id', same(parseOwned([{ app_id: ID }]), [ID]))
  check('an array of objects with appId', same(parseOwned([{ appId: ID }]), [ID]))
  check('an array of names', same(parseOwned([{ name: NAME }]), [NAME.toLowerCase()]))
  check('wrapped in {apps: [...]}', same(parseOwned({ apps: [{ id: ID }] }), [ID]))
  check('wrapped in {data: [...]}', same(parseOwned({ data: [ID] }), [ID]))
  check('wrapped in {data: {apps: [...]}}', same(parseOwned({ data: { apps: [ID] } }), [ID]))
  check('wrapped in {results: [...]}', same(parseOwned({ results: [{ product_id: ID }] }), [ID]))
  check('a FastAPI-style {success, payload}', same(parseOwned({ success: true, payload: [{ id: ID }] }), [ID]))
  check('nested {user: {apps: [...]}}', same(parseOwned({ user: { apps: [ID] } }), [ID]))
  check('numbers are read as ids', same(parseOwned([{ id: 42 }]), ['42']))

  console.log('\nWhat it must not swallow')
  check('an empty answer owns nothing', parseOwned({}).length === 0)
  check('null owns nothing', parseOwned(null).length === 0)
  check('an error body owns nothing', parseOwned({ detail: 'Not authenticated' }).length === 0)
  check('a bare "true" is not an id', !parseOwned({ success: true }).includes('true'))

  console.log('\nMatching')
  const app = (over) => ({
    id: '1',
    name: 'External Max',
    description: '',
    version: '1.0.0',
    image: '',
    fileUrl: '',
    keyauthAppId: ID,
    sha256: '',
    status: 'active',
    ...over
  })

  check('an owned product opens', access.isAvailable(app({}), [ID]) === true)
  check('an unowned product is locked', access.isAvailable(app({}), []) === false)
  check('matching ignores case', access.isAvailable(app({}), [ID.toUpperCase()]) === true)
  check('matching ignores surrounding space', access.isAvailable(app({}), [` ${ID} `]) === true)
  check('a name in the catalogue matches an id in the answer', access.isAvailable(app({ keyauthAppId: NAME }), [NAME.toLowerCase()]) === true)
  check('no app id means ungated', access.isAvailable(app({ keyauthAppId: '' }), []) === true)
  check('a locked product stays locked even when owned', access.isAvailable(app({ status: 'locked' }), [ID]) === false)
  check('the reason is "unowned", not "unavailable"', access.lockedReason(app({}), []) === 'unowned')
  check('the reason is "unavailable" when pulled', access.lockedReason(app({ status: 'locked' }), [ID]) === 'unavailable')

  console.log(
    failures === 0
      ? '\n✓ Entitlement reads every shape an honest API might use, and matches ids or names.\n'
      : `\n✗ ${failures} check(s) failed.\n`
  )
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
