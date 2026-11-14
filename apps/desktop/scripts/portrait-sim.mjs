/**
 * Account portraits: a real image, accepted once and cleaned up after.
 *
 * The claims this pins down:
 *
 *   - The type comes from the bytes. A file that only claims to be an image is
 *     refused, and a refused file leaves nothing behind on disk.
 *   - A photo is one file with one owner, replaced without orphaning the old
 *     one and forgotten when the account moves back to a mark.
 *   - Registration stores the portrait with the account, in one step, and a
 *     registration that fails for an unrelated reason (a taken username) does
 *     not leave a portrait file behind.
 *   - The renderer can read the bytes back by id, and gets the mime with them.
 *
 * Runs the real `auth` and `portrait` services against a throwaway database and
 * a throwaway media folder.
 *
 *   npm run sim:portrait
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-portrait-sim')
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

/** A real 1×1 PNG, so the signature check is tested against a real image. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const mediaFiles = () => {
  try {
    return readdirSync(media)
  } catch {
    return []
  }
}

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
  getVersion: () => '2.4.0',
  getPath: () => globalThis.__userData,
  relaunch: () => {},
  exit: () => {}
}
module.exports = {
  app,
  net: { isOnline: () => true, fetch: () => { throw new Error('offline') } },
  dialog: {},
  BrowserWindow: { getAllWindows: () => [] }
}
`
  )

  writeFileSync(
    join(work, 'entry.ts'),
    `export * from ${JSON.stringify(join(root, 'src/main/services/auth.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/portrait.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/users.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/db/database.ts'))}
`
  )

  await build({
    entryPoints: [join(work, 'entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'node:sqlite'],
    outfile: join(work, 'portrait.cjs'),
    logLevel: 'warning'
  })

  const require = createRequire(join(work, 'index.js'))
  const mod = require(join(work, 'portrait.cjs'))
  globalThis.__userData = userData
  mod.getDatabase()

  /* ---------------- what an account may call a portrait ---------------- */

  check(mod.PORTRAIT_PATTERN.test('initials'), 'initials is a portrait')
  check(mod.PORTRAIT_PATTERN.test('mark:orbit'), 'a drawn mark is a portrait')
  check(
    mod.PORTRAIT_PATTERN.test('photo:0a1b2c3d-1111-2222-3333-444455556666'),
    'a stored photo id is a portrait'
  )
  check(!mod.PORTRAIT_PATTERN.test('photo:../../etc/passwd'), 'a path is not a portrait')
  check(!mod.PORTRAIT_PATTERN.test('mark:ORBIT!'), 'an invented mark is not a portrait')
  check(!mod.PORTRAIT_PATTERN.test(''), 'an empty value is not a portrait')

  /* ---------------- installing one ---------------- */

  /* ---------------- a file picked in the system dialog ---------------- */

  const chosenPath = join(work, 'chosen.png')
  writeFileSync(chosenPath, PNG)
  const chosen = mod.readPickedPortrait(chosenPath)
  check(chosen.mime === 'image/png', 'a picked file is typed by its bytes', chosen.mime)
  check(chosen.bytes.length === PNG.length, 'its bytes come back whole')
  check(chosen.name === 'chosen.png', 'with the name for the preview', chosen.name)

  const fakePath = join(work, 'not-really.png')
  writeFileSync(fakePath, '#!/bin/sh\necho nope\n')
  check(refused(() => mod.readPickedPortrait(fakePath)) !== '', 'a picked file is checked again, not trusted')

  const emptyPath = join(work, 'empty.png')
  writeFileSync(emptyPath, '')
  check(refused(() => mod.readPickedPortrait(emptyPath)) !== '', 'an empty pick is refused')

  const value = mod.installPortrait(PNG, 'me.png')
  check(/^photo:[0-9a-f-]{36}$/.test(value), 'installing returns a photo id', value)
  check(mediaFiles().length === 1, 'exactly one file is written', String(mediaFiles().length))
  check(
    !mediaFiles()[0].includes('me.png'),
    'the stored name is the id, not the file the person picked',
    mediaFiles()[0]
  )

  const id = mod.portraitMediaId(value)
  const served = mod.readPortraitFile(id)
  check(served !== null && served.bytes.length === PNG.length, 'the bytes come back by id')
  check(served?.mime === 'image/png', 'with the type the signature proved', served?.mime)

  const notAnImage = Buffer.from('#!/bin/sh\necho not an image\n')
  const refusedType = refused(() => mod.installPortrait(notAnImage, 'evil.png'))
  check(refusedType !== '', 'a file that only claims to be an image is refused')
  check(mediaFiles().length === 1, 'and nothing is written for it', String(mediaFiles().length))

  const tooBig = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024, 0)])
  const refusedSize = refused(() => mod.installPortrait(tooBig, 'huge.png'))
  check(refusedSize !== '', 'an oversized photo is refused')
  check(mediaFiles().length === 1, 'and nothing is written for it', String(mediaFiles().length))

  /* ---------------- replacing, then forgetting ---------------- */

  const second = mod.installPortrait(
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]),
    'me.jpg'
  )
  check(second !== value, 'a second photo is a second id')
  check(mod.readPortraitFile(id) !== null, 'the first still exists until something points away from it')

  mod.removePortrait(value)
  check(mod.readPortraitFile(id) === null, 'forgetting a photo makes its bytes unreadable')
  check(mediaFiles().length === 1, 'and deletes its file', String(mediaFiles().length))
  mod.removePortrait(second)

  /* ---------------- registering with a photo ---------------- */

  const registered = mod.register({
    username: 'portrait',
    displayName: 'Portrait Tester',
    email: 'portrait@example.com',
    password: 'correct-horse-battery',
    avatarPhoto: { bytes: PNG, name: 'me.png' }
  })
  check(
    /^photo:[0-9a-f-]{36}$/.test(registered.avatar ?? ''),
    'the account is created with the photo on it',
    String(registered.avatar)
  )
  check(mediaFiles().length === 1, 'exactly one portrait file exists', String(mediaFiles().length))

  const storedBytes = mod.readPortraitFile(mod.portraitMediaId(registered.avatar))
  check(storedBytes !== null && storedBytes.bytes.length === PNG.length, 'its bytes are readable')

  const reread = mod.findUserById(registered.id)
  check(reread?.avatar === registered.avatar, 'the session and the row agree about the portrait')

  /* ---------------- a mark replaces the photo, and clears the file ------- */

  const marked = mod.updateProfile(registered, {
    displayName: registered.displayName,
    email: registered.email,
    avatar: 'mark:orbit'
  })
  check(marked.avatar === 'mark:orbit', 'a mark replaces the photo')
  check(mediaFiles().length === 0, 'and the photo file is not left behind', String(mediaFiles().length))

  /* ---------------- a failed registration leaves nothing -------------- */

  const before = mediaFiles().length
  const duplicate = refused(() =>
    mod.register({
      username: 'portrait',
      displayName: 'Someone Else',
      email: 'other@example.com',
      password: 'correct-horse-battery',
      avatarPhoto: { bytes: PNG, name: 'me.png' }
    })
  )
  check(duplicate !== '', 'a taken username is refused')
  check(mediaFiles().length === before, 'and the portrait it carried is not kept', String(mediaFiles().length))

  /* ---------------- an invented portrait is refused at the door ------- */

  const badAvatar = refused(() =>
    mod.register({
      username: 'weird',
      displayName: 'Weird Portrait',
      email: 'weird@example.com',
      password: 'correct-horse-battery',
      avatar: 'photo:../../secrets'
    })
  )
  check(badAvatar !== '', 'an invented portrait value is refused')
  check(mediaFiles().length === before, 'and nothing is written for it', String(mediaFiles().length))

  mod.closeDatabase?.()
  console.log(failures === 0 ? '\nportraits: all checks passed' : `\n${failures} check(s) failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
