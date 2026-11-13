/**
 * About: the portrait, and what happens to a file that only claims to be one.
 *
 * The claim: an administrator's photo is accepted when it really is an image,
 * refused when it is not, replaced without leaving the old file behind, and
 * served to the renderer as bytes — never as a path.
 *
 * Runs the real `about` service against a throwaway database and a throwaway
 * media folder.
 *
 *   npm run sim:about
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-about-sim')
const userData = join(work, 'userdata')
const media = join(userData, 'media')

let failures = 0
const check = (pass, label, detail) => {
  if (pass) console.log(`✓ ${label}`)
  else {
    failures += 1
    console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const refused = (run) => {
  try {
    run()
    return ''
  } catch (error) {
    return String(error?.code ?? error?.message ?? error)
  }
}

/** A real 1×1 PNG, so the signature check is tested against a real file. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

async function main() {
  rmSync(work, { recursive: true, force: true })
  mkdirSync(userData, { recursive: true })
  mkdirSync(join(work, 'node_modules', 'electron'), { recursive: true })

  writeFileSync(
    join(work, 'node_modules', 'electron', 'package.json'),
    JSON.stringify({ name: 'electron', version: '45.0.0', main: 'index.js' })
  )
  writeFileSync(
    join(work, 'node_modules', 'electron', 'index.js'),
    `const app = {
  isPackaged: true,
  getVersion: () => '2.0.0',
  getPath: () => globalThis.__userData,
  relaunch: () => {},
  exit: () => {}
}
module.exports = { app, net: { fetch: () => { throw new Error('offline') } }, dialog: {}, BrowserWindow: { getAllWindows: () => [] } }
`
  )

  writeFileSync(
    join(work, 'entry.ts'),
    `export * from ${JSON.stringify(join(root, 'src/main/services/about.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/db/database.ts'))}
`
  )

  await build({
    entryPoints: [join(work, 'entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'node:sqlite'],
    outfile: join(work, 'about.cjs'),
    logLevel: 'warning'
  })

  const require = createRequire(join(work, 'index.js'))
  const about = require(join(work, 'about.cjs'))
  globalThis.__userData = userData

  const empty = about.readAbout()
  check(empty.appName === 'INDRA HUB', 'the app names itself')
  check(/^\d+\.\d+\.\d+/.test(empty.version), 'the version is the one running', empty.version)
  check(empty.developer.hasPhoto === false, 'a fresh installation has no portrait')
  check(about.readDeveloperPhotoFile() === null, 'and no bytes to serve')

  const png = join(work, 'portrait.png')
  writeFileSync(png, PNG)
  const installed = about.installDeveloperPhoto(png, 'portrait.png')
  check(installed.developer.hasPhoto === true, 'a real PNG is accepted')
  check(installed.developer.mime === 'image/png', 'the type comes from the bytes', installed.developer.mime)
  check(installed.developer.bytes === PNG.length, 'the size is the file’s', String(installed.developer.bytes))
  check(Boolean(installed.developer.updatedAt), 'the card can say when it was set')

  const served = about.readDeveloperPhotoFile()
  check(served !== null && served.bytes.length === PNG.length, 'the bytes are what the renderer receives')
  check(served.mime === 'image/png', 'with the mime type alongside them')
  check(
    JSON.stringify(about.readAbout()).includes(media) === false,
    'no filesystem path leaks into what the card is given'
  )

  const files = readdirSync(media)
  check(files.length === 1, 'exactly one file sits in the media folder', String(files.length))
  check(!files[0].includes('portrait'), 'the stored file is named by id, not by the person’s file name', files[0])
  const firstFile = files[0]

  // A second, valid replacement.
  const jpegHead = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)])
  const jpeg = join(work, 'portrait.jpg')
  writeFileSync(jpeg, jpegHead)
  const replaced = about.installDeveloperPhoto(jpeg, 'portrait.jpg')
  check(replaced.developer.mime === 'image/jpeg', 'a JPEG replaces a PNG')
  const after = readdirSync(media)
  check(after.length === 1 && after[0] !== firstFile, 'the old file is removed once the new one is in place', after.join(','))
  check(about.readAbout().developer.mime === 'image/jpeg', 'the active record points at the new portrait')

  // A file that lies about what it is.
  const fake = join(work, 'not-an-image.png')
  writeFileSync(fake, 'this is text, not a PNG')
  check(
    refused(() => about.installDeveloperPhoto(fake, 'not-an-image.png')) === 'VALIDATION',
    'a file that only claims to be an image is refused'
  )
  check(after.length === 1, 'and the portrait already installed is untouched')

  // An empty file.
  const blank = join(work, 'blank.png')
  writeFileSync(blank, Buffer.alloc(0))
  check(refused(() => about.installDeveloperPhoto(blank)) === 'VALIDATION', 'an empty file is refused')

  // Too large: a valid signature with a huge tail.
  const big = join(work, 'huge.png')
  writeFileSync(big, Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]))
  check(refused(() => about.installDeveloperPhoto(big)) === 'VALIDATION', 'an image over 8 MB is refused')

  // A path that does not exist.
  check(refused(() => about.installDeveloperPhoto(join(work, 'ghost.png'))) === 'VALIDATION', 'a missing file is refused')

  const cleared = about.removeDeveloperPhoto()
  check(cleared.developer.hasPhoto === false, 'removing the portrait empties the circle')
  check(readdirSync(media).length === 0, 'and deletes the file')
  check(about.readDeveloperPhotoFile() === null, 'with nothing left to serve')
  check(about.readAbout().version === cleared.version, 'the version is unaffected by any of this')

  console.log(
    failures === 0 ? '\n✓ the portrait is validated, replaced cleanly, and served as bytes' : `\n${failures} check(s) failed`
  )
  if (failures > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
})
