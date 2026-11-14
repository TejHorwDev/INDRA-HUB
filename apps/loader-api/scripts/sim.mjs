/**
 * The panel, checked without a browser or a database.
 *
 * Three things can be wrong here and none of them show up in a type check:
 *
 *   1. A password that a wrong guess can pass, or a session token a client can
 *      forge. Both are checked by trying.
 *   2. An upload key that reaches outside the bucket. Checked by trying that too.
 *   3. An admin route that forgot to check the session. Checked by reading every
 *      route file, because that is the mistake that ships silently.
 *
 *   npm run sim
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-loader-api-sim')
/*
 * Bundles are written inside the project, not the temp folder: the AWS SDK and
 * Supabase are kept external (bundled to ESM they break on `require('node:https')`)
 * and they have to resolve from this project's node_modules.
 */
const buildDir = join(root, '.sim')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

async function bundle(entry, name, stubs = {}) {
  const outfile = join(buildDir, `${name}.mjs`)
  await build({
    entryPoints: [join(root, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'silent',
    // Native-CJS dependencies stay outside the bundle.
    external: ['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner', '@supabase/supabase-js'],
    // `next/headers` only exists inside a request; these modules are tested for
    // their logic, not their request plumbing.
    plugins: Object.keys(stubs).length
      ? [
          {
            name: 'stubs',
            setup(build) {
              for (const name of Object.keys(stubs)) {
                build.onResolve({ filter: new RegExp(`^${name}$`) }, () => ({
                  path: name,
                  namespace: 'stub'
                }))
              }
              build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
                contents: stubs[args.path],
                loader: 'js'
              }))
            }
          }
        ]
      : []
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else files.push(full)
  }
  return files
}

async function main() {
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  rmSync(buildDir, { recursive: true, force: true })
  mkdirSync(buildDir, { recursive: true })

  /* -------------------------------------------------------------- auth ---- */

  process.env.ADMIN_USERNAME = 'tej'
  process.env.ADMIN_PASSWORD = 'correct-horse-battery-staple'
  process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString('base64url')

  const auth = await bundle('src/lib/auth.ts', 'auth', {
    'next/headers': 'export async function cookies(){ return { get(){ return undefined } } }'
  })

  console.log('\nThe password')
  check('the right one is accepted', auth.checkCredentials('tej', 'correct-horse-battery-staple') === true)
  check('a wrong one is not', auth.checkCredentials('tej', 'correct-horse-battery') === false)
  check('the username is case-insensitive', auth.checkCredentials('TEJ', 'correct-horse-battery-staple') === true)
  check('a different user is refused', auth.checkCredentials('admin', 'correct-horse-battery-staple') === false)
  check('an empty password is refused', auth.checkCredentials('tej', '') === false)
  check('a prefix is refused', auth.checkCredentials('tej', 'correct-horse-battery-stapl') === false)

  console.log('\nThe session token')
  const token = await auth.issueSession()
  check('a token it issued verifies', (await auth.verifySession(token)) === true)
  check('a missing token does not', (await auth.verifySession(undefined)) === false)
  check('garbage does not', (await auth.verifySession('not-a-token')) === false)

  const [header, , signature] = token.split('.')
  const forged = `${header}.${Buffer.from(JSON.stringify({ role: 'admin' })).toString('base64url')}.${signature}`
  check('a forged payload does not', (await auth.verifySession(forged)) === false)

  const flipped = `${token.slice(0, -2)}${token.slice(-2) === 'AA' ? 'BB' : 'AA'}`
  check('a changed signature does not', (await auth.verifySession(flipped)) === false)

  /* ----------------------------------------------------------- storage ---- */

  process.env.STORAGE_DRIVER = 'local'
  const storage = await bundle('src/lib/storage.ts', 'storage')

  console.log('\nStorage keys')
  check('an installer key is under exes/', storage.objectKey('exe', 'Aurora.exe').startsWith('exes/'))
  check('an image key is under images/', storage.objectKey('image', 'cover.png').startsWith('images/'))
  check(
    'a hostile filename cannot escape its folder',
    !storage.objectKey('exe', '../../../etc/passwd').slice(6).includes('/'),
    storage.objectKey('exe', '../../../etc/passwd')
  )
  check('keys we issue validate', storage.isObjectKey(storage.objectKey('exe', 'a.exe')) === true)
  check('traversal does not', storage.isObjectKey('exes/../../secret') === false)
  check('an absolute path does not', storage.isObjectKey('/etc/passwd') === false)
  check('an empty key does not', storage.isObjectKey('') === false)

  console.log('\nThe storage round trip')
  // Point the local driver at the temporary folder so nothing touches the repo.
  process.chdir(work)
  mkdirSync(join(work, '.data', 'uploads'), { recursive: true })

  const body = randomBytes(64 * 1024)
  const target = await storage.createUploadTarget('exe', 'Aurora Setup.exe', 'application/octet-stream')
  await storage.localWrite(target.key, Readable.from([body]))

  const stream = await storage.openObject(target.key)
  check('something comes back', stream !== null)

  if (stream) {
    const chunks = []
    const hash = createHash('sha256')
    await new Promise((resolve, reject) => {
      stream.on('data', (chunk) => {
        chunks.push(chunk)
        hash.update(chunk)
      })
      stream.on('end', resolve)
      stream.on('error', reject)
    })
    const stored = Buffer.concat(chunks)
    check('byte for byte what was written', stored.equals(body), `${stored.length} of ${body.length}`)
    check(
      'and hashes to the same value the server would publish',
      hash.digest('hex') === createHash('sha256').update(body).digest('hex')
    )
  }

  check('a missing object is null, not a throw', (await storage.openObject('exes/nope.exe')) === null)

  /*
   * A download that cannot be measured looks frozen, and a download that cannot be
   * resumed starts from zero. Both come from the same missing header, so both are checked
   * here: the object's real length, and a slice of it that matches the same bytes.
   */
  console.log('\nA file served with a length, and in ranges')
  const whole = await storage.readObject(target.key)
  check('the size is reported', whole?.size === body.length, String(whole?.size))
  check('and the length of the response is the same', whole?.length === body.length)
  check('with no range claimed', whole?.range === null)

  const slice = await storage.readObject(target.key, { start: 1000, end: 1999 })
  check('a range comes back as a range', slice?.range?.start === 1000 && slice?.range?.end === 1999)
  check('its length is the slice, not the file', slice?.length === 1000)
  check('and the total is still the whole file', slice?.size === body.length)

  if (slice) {
    const chunks = []
    await new Promise((resolve, reject) => {
      slice.stream.on('data', (chunk) => chunks.push(chunk))
      slice.stream.on('end', resolve)
      slice.stream.on('error', reject)
    })
    check('the bytes are the ones at that offset', Buffer.concat(chunks).equals(body.subarray(1000, 2000)))
  }

  check('a range past the end is nothing at all', (await storage.readObject(target.key, { start: body.length })) === null)

  const range = await bundle('src/lib/http-range.ts', 'http-range')
  check('`bytes=0-` is the whole file', JSON.stringify(range.parseRange('bytes=0-')) === '{"start":0}')
  check('`bytes=5-9` is a slice', range.parseRange('bytes=5-9')?.end === 9)
  check('a reversed range is ignored', range.parseRange('bytes=9-5') === null)
  check('an absurd header is ignored', range.parseRange('bananas') === null)
  check('no header means no range', range.parseRange(null) === null)

  /* -------------------------------------------------------------- routes -- */

  console.log('\nEvery admin route checks the session')
  const adminRoutes = walk(join(root, 'src/app/api/admin')).filter((file) => file.endsWith('route.ts'))
  const unguarded = adminRoutes.filter((file) => {
    const source = readFileSync(file, 'utf8')
    // Two routes are deliberately open: login is the way in, and logout clearing
    // a cookie that may already be gone is not an action worth guarding.
    if (file.includes('/admin/login/') || file.includes('/admin/logout/')) return false
    return !source.includes('currentSession(')
  })
  check(
    `${adminRoutes.length} route(s) guarded`,
    unguarded.length === 0,
    unguarded.map((f) => relative(root, f)).join(', ')
  )

  console.log('\nThe public surface is read-only')
  const publicRoutes = walk(join(root, 'src/app/api/loader')).filter((file) => file.endsWith('route.ts'))
  const writable = publicRoutes.filter((file) => /export async function (POST|PUT|PATCH|DELETE)/.test(readFileSync(file, 'utf8')))
  check('no public route accepts a write', writable.length === 0, writable.map((f) => relative(root, f)).join(', '))

  console.log('\nNothing secret is exposed to the browser')
  const clientFiles = walk(join(root, 'src')).filter(
    (file) => file.endsWith('.tsx') && readFileSync(file, 'utf8').startsWith("'use client'")
  )
  const leaks = clientFiles.filter((file) =>
    /SERVICE_ROLE|SUPABASE_SERVICE|ADMIN_PASSWORD|ADMIN_SESSION_SECRET/.test(readFileSync(file, 'utf8'))
  )
  check('no client component names a secret', leaks.length === 0, leaks.map((f) => relative(root, f)).join(', '))

  rmSync(buildDir, { recursive: true, force: true })

  console.log(
    failures === 0
      ? '\n✓ Wrong passwords fail, forged tokens fail, keys cannot escape, and every admin route is guarded.\n'
      : `\n✗ ${failures} check(s) failed.\n`
  )
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
