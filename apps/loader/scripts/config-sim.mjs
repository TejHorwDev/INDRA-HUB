/**
 * The published settings, and what the app makes of them.
 *
 * `toConfig` is the one place the panel's text keys become the app's states, and it
 * is where a typo becomes an incident: `'1'` is maintenance, `'0'` is a normal day,
 * and a row somebody hand-wrote might say `true`. Getting this wrong closes the app
 * for everybody or leaves a closed sign up for a week.
 *
 *   npm run sim:config
 */
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(root, '.sim')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

const outfile = join(work, 'config.mjs')
await build({
  entryPoints: [join(root, 'src/main/services/catalog.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'silent'
})

const { toConfig } = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)

console.log('\nSettings')

const empty = toConfig(null)
check('nothing published is an empty setting, not a crash', empty.website === '' && empty.video === '' && empty.notice === '' && empty.maintenance === false)
check('absent maintenance means open', toConfig({}).maintenance === false)
check('"1" closes the door', toConfig({ maintenance: '1' }).maintenance === true)
check('"0" opens it', toConfig({ maintenance: '0' }).maintenance === false)
check('a hand-written true closes it too', toConfig({ maintenance: true }).maintenance === true)
check('"false" does not close it', toConfig({ maintenance: 'false' }).maintenance === false)

check('the film survives with its query string', toConfig({ video: ' https://a/v.mp4?v=2 ' }).video === 'https://a/v.mp4?v=2')
check('a blank film is not a film', toConfig({ video: '   ' }).video === '')
check('the announcement is kept verbatim apart from edge space', toConfig({ notice: '  back at 02:00  ' }).notice === 'back at 02:00')
check('the website link is trimmed', toConfig({ website: ' https://indra-cheats.com ' }).website === 'https://indra-cheats.com')
check('a number where text belongs is ignored', toConfig({ video: 42, notice: null }).video === '' && toConfig({ video: 42 }).notice === '')
check('unknown keys are dropped, not carried', !('sale' in toConfig({ sale: '1' })))

if (failures > 0) {
  console.log(`\n✗ ${failures} check(s) failed.`)
  process.exit(1)
}

console.log('\n✓ Settings parse to exactly what the panel meant.\n')
