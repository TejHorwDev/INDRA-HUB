/**
 * INDRA HUB and INDRA LOADER must stay two applications.
 *
 * They install side by side on one machine and, later, publish from one
 * repository. Every value below is something that, if it matched, would merge
 * them: a shared data folder, a shared taskbar group, a shared release train.
 *
 * This is a build-time guard, not documentation. The copy-paste that starts a new
 * Electron app is exactly where these values get inherited by accident.
 *
 *   npm run sim:isolation
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const hub = join(root, '..', 'desktop')

const read = (path) => readFileSync(path, 'utf8')
// Nested keys are indented, so leading whitespace is expected.
const yamlValue = (text, key) => {
  const match = text.match(new RegExp(`^[ \\t]*${key}:\\s*(.+)$`, 'm'))
  return match ? match[1].trim() : null
}

let failures = 0
const same = (label, left, right) => {
  const ok = typeof left === 'string' && typeof right === 'string' && left !== right
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${left} ${ok ? '≠' : '=='} ${right}`)
  if (!ok) failures += 1
}

const loaderBuilder = read(join(root, 'electron-builder.yml'))
const hubBuilder = read(join(hub, 'electron-builder.yml'))
const loaderPkg = JSON.parse(read(join(root, 'package.json')))
const hubPkg = JSON.parse(read(join(hub, 'package.json')))

console.log('\nIdentity')
same('appId', yamlValue(loaderBuilder, 'appId'), yamlValue(hubBuilder, 'appId'))
same('productName', yamlValue(loaderBuilder, 'productName'), yamlValue(hubBuilder, 'productName'))
same('package name', loaderPkg.name, hubPkg.name)
same('shortcutName', yamlValue(loaderBuilder, 'shortcutName'), yamlValue(hubBuilder, 'shortcutName'))

console.log('\nInstaller')
same(
  'artifactName',
  yamlValue(loaderBuilder, 'artifactName'),
  yamlValue(hubBuilder, 'artifactName')
)

console.log('\nUpdate train')
const updates = read(join(root, 'src/main/services/updates.ts'))
const tagPrefix = updates.match(/const TAG_PREFIX = '([^']+)'/)?.[1] ?? null
// The hub tags plain `v<version>`. A loader tag must start with a literal that
// no version string can produce, or `selectRelease` would match hub releases.
const distinct = typeof tagPrefix === 'string' && /^[a-z]/.test(tagPrefix)
if (!distinct) {
  console.log(`  ✗ the loader tag prefix "${tagPrefix}" could match a hub release`)
  failures += 1
} else {
  console.log(`  ✓ tag prefix ${tagPrefix} (hub uses v<version>, which cannot match)`)
}

console.log(
  failures === 0
    ? '\n✓ The two apps share no identity. Both can install and update independently.\n'
    : `\n✗ ${failures} shared identity value(s).\n`
)
process.exitCode = failures === 0 ? 0 : 1
