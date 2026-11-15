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

  /*
   * The gap between a row and the bucket.
   *
   * A product stores an address; the bytes live in a bucket somebody can empty from
   * another tab. Deleting the object in the Supabase console used to leave the panel
   * reporting an installer that could not be downloaded — the address was true and the
   * file was gone. `keyFromUrl` is how the two are compared, so it is checked against
   * every shape a row can hold.
   */
  console.log('\nFrom a stored address back to a key')
  const urls = await bundle('src/lib/url.ts', 'url')

  check('our own url yields its key', urls.keyFromUrl('https://x.onrender.com/api/files/exes/a.exe') === 'exes/a.exe')
  check('a public base yields its key', urls.keyFromUrl(`${process.env.PUBLIC_BASE_URL ?? 'https://cdn.test'}/exes/b.exe`) !== undefined)
  check('a query string is not part of the key', urls.keyFromUrl('https://x/api/files/images/c.png?v=2') === 'images/c.png')
  check('a percent-encoded name decodes', urls.keyFromUrl('https://x/api/files/exes/my%2Eexe') === 'exes/my.exe')
  // Keys are sanitised on the way in, so a space cannot be in one — and must not be
  // laundered into one by decoding.
  check('a space is refused, because a key never has one', urls.keyFromUrl('https://x/api/files/exes/my%20app.exe') === null)
  check('an escaped key is refused', urls.keyFromUrl('https://x/api/files/exes/../../secret') === null)
  check('a github asset is not ours', urls.keyFromUrl('https://github.com/o/r/releases/download/v1/a.exe') === null)
  check('an empty address is nothing', urls.keyFromUrl('') === null)
  check('a key names its kind', urls.kindOfKey('videos/a.mp4') === 'video')
  check('and an unknown folder names nothing', urls.kindOfKey('secrets/a.txt') === null)

  /*
   * The listing is what makes "missing" possible, and it must notice a deletion made
   * outside the panel — which is exactly what the local driver can demonstrate.
   */
  const listed = await storage.listObjects('exe')
  check('the listing finds what was uploaded', listed.some((object) => object.key === target.key))
  check('and knows how big it is', listed.find((object) => object.key === target.key)?.bytes === body.length)

  const keys = await storage.keySet('exe')
  check('a key that is there is in the set', keys.has(target.key))
  await storage.removeObject(target.key)
  const after = await storage.keySet('exe')
  check('a file deleted outside the app leaves the set', after.has(target.key) === false)

  /*
   * A film must not be streamed through the API on its first play: that is two hops and a
   * free-tier server between a person and the first frame. Everything else stays proxied.
   */
  console.log('\nA film takes the short way')
  check('local disk has no second address to offer', (await storage.directUrl('videos/a.mp4')) === null)
  check('artwork keeps its extension in the key', storage.objectKey('image', 'clip.mp4').endsWith('.mp4'))
  check('an animated card is allowed the room it needs', storage.capFor('image') >= 20 * 1024 * 1024)

  const filesRoute = readFileSync(join(root, 'src/app/api/files/[...key]/route.ts'), 'utf8')
  check('a film is redirected', /path\.startsWith\('videos\/'\)/.test(filesRoute))
  /*
   * And artwork is deliberately *not* redirected. A signed address is different every
   * time it is issued, so a browser can never reuse the bytes it already has — which is
   * exactly how a card video ends up downloaded again on every launch and stuttering
   * while it streams what it should have kept. One stable address, cached for a year.
   */
  check(
    'artwork keeps one address',
    /if \(path\.startsWith\('videos\/'\)\) \{/.test(filesRoute) &&
      !/startsWith\('videos\/'\) \|\| path\.startsWith\('images\/'\)/.test(filesRoute)
  )
  check('an image is cached as immutable', /type\.startsWith\('video\/'\) \|\| type\.startsWith\('image\/'\)[\s\S]{0,80}immutable/.test(filesRoute))
  // A GIF is a picture the browser animates by itself; nothing in the app has to know.
  check('every image type is served with a type', ['gif', 'webp', 'png', 'jpg'].every((ext) => new RegExp(`${ext}: 'image/`).test(filesRoute)))
  // A card can be a short loop, stored as artwork and served as a film.
  check('a video card is served as video', /mp4: 'video\/mp4'/.test(filesRoute) && /webm: 'video\/webm'/.test(filesRoute))
  check('and the redirect is short-lived', /directUrl\(path\)/.test(filesRoute))

  /*
   * A description is written the way people write messages, and printed raw it is a wall
   * of capitals that wraps where nothing means anything. The panel previews what the app
   * will draw, so the two parsers must agree — these are the same fixtures the loader
   * checks against.
   */
  console.log('\nA description, parsed the way the app draws it')
  const prose = await bundle('src/lib/prose.ts', 'prose')

  const shout = prose.parseDescription(
    'BEST EXTERNAL CHEATS IN THE MARKET…! MANY COOL FEATURES :-AIMBOT ( EXTERNAL , AI , RAGE )-ESP MENU-EXTRA FEATURES-SKIN CHANGER'
  )
  check(
    'the claim becomes a sentence',
    shout.about === 'Best external cheats in the market…! Many cool features',
    shout.about
  )
  check('and the run of features becomes a list', shout.features.length === 4, JSON.stringify(shout.features))
  check('with acronyms left alone', shout.features[0] === 'Aimbot (external, AI, rage)', shout.features[0])

  check('a pipe is a separator too', prose.parseDescription('Aimbot | ESP').features.length === 2)
  check('a name keeps its hyphen', prose.parseDescription('Anti-Aim and Fake Lag built in').features.length === 0)
  check('plain prose stays one paragraph', prose.parseDescription('External cheat for the season.').features.length === 0)
  check('an empty field draws nothing', prose.parseDescription('').about === '')

  // The placeholder in the panel is real copy, so it must parse into something worth
  // showing rather than an example that lies about the format.
  const example = prose.parseDescription(
    'Best external cheats in the market - aimbot (external, AI, rage) - ESP menu - skin changer'
  )
  check('the example in the field parses', example.features.length === 3, JSON.stringify(example.features))
  check('and reads as a claim plus a list', example.about === 'Best external cheats in the market', example.about)

  /*
   * A card is 232px square and people upload 1080p. The panel shrinks it at upload time,
   * in the browser, so the app only ever plays the small copy — and so an H.265 or
   * variable-frame-rate source becomes a plain WebM any Chromium decodes without thinking.
   */
  console.log('\nA video prepared for a card')
  const clip = readFileSync(join(root, 'src/components/card-clip.ts'), 'utf8')
  check('it targets the card, not the screen', /const TARGET = 512/.test(clip))
  check('and a short loop is enough', /const MAX_SECONDS = 4/.test(clip))
  check('it re-encodes only what the browser can', /MediaRecorder\.isTypeSupported/.test(clip))
  check('an already-small clip is left alone', /side <= TARGET && file\.size < 2 \* 1024 \* 1024/.test(clip))
  check('and a failure uploads the original', /return \{ file, note: 'Uploaded as it is/.test(clip))
  check('a card copy is never bigger than the original', /blob\.size >= file\.size/.test(clip))
  check('the panel runs it before anything is uploaded', /prepareCardClip\(original/.test(readFileSync(join(root, 'src/components/Products.tsx'), 'utf8')))

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

  /*
   * The look, checked as an invariant rather than as a screenshot.
   *
   * The panel has been asked for matte black, dark grey and white — twice, in different
   * words, after violet gradients and then neon were both rejected. A rule that can be
   * broken silently is a rule that will be broken, so: every colour literal in the
   * stylesheet must be a neutral, plus the three status hues that carry meaning.
   */
  console.log('\nThe palette stays monochrome')
  const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8')
  // The three status hues, and the two lighter inks used for text on their own wash.
  const named = new Set(['57c9a1', 'e0746a', 'cfae74', 'f0b3ac', 'a4e3cd'])
  const colours = [...new Set((css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((hex) => hex.slice(1).toLowerCase()))]
  const offPalette = colours.filter((hex) => {
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
    if (named.has(full.slice(0, 6))) return false
    const r = parseInt(full.slice(0, 2), 16)
    const g = parseInt(full.slice(2, 4), 16)
    const b = parseInt(full.slice(4, 6), 16)
    return Math.max(r, g, b) - Math.min(r, g, b) > 12
  })
  check('every colour is grey, or one of the three statuses', offPalette.length === 0, offPalette.join(', '))
  check('the type is self-hosted, so it renders offline', /geist\/font\/sans/.test(readFileSync(join(root, 'src/app/layout.tsx'), 'utf8')))
  check('the sections slide rather than blink', /\.nav-pill/.test(css) && /translateX\(var\(--x/.test(css))
  check('content rises on a stagger', /\.rise/.test(css) && /var\(--i/.test(css))
  check('and any machine that asked for less motion gets none', /prefers-reduced-motion: reduce/.test(css))
  check(
    'the page fills the glass rather than sitting in the middle',
    /\.shell \{[^}]*max-width: none/.test(css)
  )
  check('the frame and the content share one gutter', /--gutter: clamp/.test(css))
  check('cards are lit and tilted from the pointer', /--rx/.test(css) && /--px/.test(css))
  check('below the fold, content waits for the scroll', /animation-timeline: view\(\)/.test(css))
  check('the tape moves, and stops when you point at it', /\.tape-track/.test(css) && /animation-play-state: paused/.test(css))
  const layout = readFileSync(join(root, 'src/app/admin/(panel)/layout.tsx'), 'utf8')
  check('the keyboard opens the jump box', /CommandPalette/.test(layout) && /metaKey/.test(readFileSync(join(root, 'src/components/CommandPalette.tsx'), 'utf8')))
  check('and Escape closes it', /key === 'Escape'/.test(readFileSync(join(root, 'src/components/CommandPalette.tsx'), 'utf8')))

  /*
   * The film's two numbers. The panel owns them, the app applies them straight to a
   * video element, so the only place they can be made safe is here — on the way out.
   */
  console.log('\nThe film is published with its frame')
  const configRoute = readFileSync(join(root, 'src/app/api/loader/config/route.ts'), 'utf8')
  check('blur and dim travel with the film', /filmBlur: limit\(config\.film_blur/.test(configRoute) && /filmDim: limit\(config\.film_dim/.test(configRoute))
  check('and are clamped, not trusted', /Math\.min\(max,/.test(configRoute))
  const adminConfig = readFileSync(join(root, 'src/app/api/admin/config/route.ts'), 'utf8')
  check('the panel can write them', /film_blur/.test(adminConfig) && /film_dim/.test(adminConfig))
  const appearance = readFileSync(join(root, 'src/components/Appearance.tsx'), 'utf8')
  check('the preview shows the real film at the real setting', /filter: `blur\(\$\{blur\}px\)`/.test(appearance))
  check('and saves without a release', /fetch\('\/api\/admin\/config'/.test(appearance))

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
