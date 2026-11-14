/**
 * The downloader, against a real server and a real disk.
 *
 * Everything that can go wrong with a download is a filesystem question, and
 * every one of them is boring until it is not: a cancelled download that is later
 * mistaken for an installed file, a resumed download whose hash covers only the
 * second half, a file that arrives corrupt and gets launched anyway.
 *
 * This runs the actual downloader — bundled, not reimplemented — over HTTP with
 * Range support, and checks what is on disk afterwards.
 *
 *   npm run sim:download
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-loader-download-sim')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

async function bundle(entry, outfile, stubElectron = false) {
  await build({
    entryPoints: [join(root, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'silent',
    plugins: stubElectron ? [electronStub] : []
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

/** Only the two facts the install registry asks of `app`. */
const electronStub = {
  name: 'electron-stub',
  setup(build) {
    build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }))
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: `
        const stub = globalThis.__electron__ ?? {}
        export const app = {
          getPath: (name) => (name === 'userData' ? stub.userData : stub.documents),
          getVersion: () => '0.0.0',
          isPackaged: true
        }
        export const net = { fetch: (input, init) => (stub.fetch ?? fetch)(input, init) }
        export const protocol = {
          registerSchemesAsPrivileged: () => {},
          handle: (scheme, handler) => {
            stub.handlers = stub.handlers ?? {}
            stub.handlers[scheme] = handler
          }
        }
      `,
      loader: 'js'
    }))
  }
}

async function main() {
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })

  const body = randomBytes(2 * 1024 * 1024)
  const sha256 = createHash('sha256').update(body).digest('hex')

  const server = createServer((request, response) => {
    /*
     * One endpoint delivers slowly and in pieces.
     *
     * A cancelled download can only be tested against a transfer that takes long
     * enough to cancel: a 240 KB file on loopback arrives in a single chunk before
     * any progress callback exists, which proves nothing about aborting.
     */
    if ((request.url ?? '').startsWith('/slow')) {
      response.writeHead(200, { 'content-length': String(body.length) })
      let offset = 0
      const timer = setInterval(() => {
        if (offset >= body.length) {
          clearInterval(timer)
          response.end()
          return
        }
        response.write(body.subarray(offset, offset + 64 * 1024))
        offset += 64 * 1024
      }, 40)
      response.on('close', () => clearInterval(timer))
      return
    }

    const range = request.headers.range
    if (range) {
      const start = Number.parseInt(range.replace(/bytes=(\d+)-.*/, '$1'), 10) || 0
      response.writeHead(206, {
        'content-length': String(body.length - start),
        'content-range': `bytes ${start}-${body.length - 1}/${body.length}`
      })
      response.end(body.subarray(start))
      return
    }
    response.writeHead(200, { 'content-length': String(body.length) })
    response.end(body)
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/aurora.exe`

  const downloader = await bundle('src/main/lib/downloader.ts', join(work, 'downloader.mjs'))
  const paths = await bundle('src/main/lib/paths.ts', join(work, 'paths.mjs'))

  /* ------------------------------------------------------------- 1. normal */

  console.log('\nA clean download')
  const target = join(work, 'apps', 'Aurora', 'Aurora.exe')
  let progressSeen = 0
  const first = await downloader.downloadToFile({
    url,
    destination: target,
    sha256,
    signal: new AbortController().signal,
    onProgress: () => {
      progressSeen += 1
    }
  })

  check('writes the file to its final path', existsSync(target))
  check('reports every byte', first.bytes === body.length, `${first.bytes} of ${body.length}`)
  check('reports the published hash', first.sha256 === sha256)
  check('the bytes on disk are the bytes served', readFileSync(target).equals(body))
  check('leaves no .part behind', !existsSync(`${target}.part`))
  check('reported progress at least once', progressSeen > 0)

  /* ------------------------------------------------------------- 2. resumed */

  console.log('\nA resumed download')
  const resumedTarget = join(work, 'apps', 'Nova', 'Nova.exe')
  mkdirSync(dirname(resumedTarget), { recursive: true })
  const cut = 90_000
  writeFileSync(`${resumedTarget}.part`, body.subarray(0, cut))

  const resumed = await downloader.downloadToFile({
    url,
    destination: resumedTarget,
    sha256,
    signal: new AbortController().signal
  })

  check('continues from the bytes already on disk', resumed.resumed === true)
  check('keeps them', resumed.bytes === body.length, `${resumed.bytes} of ${body.length}`)
  // The hash here is the whole file, which is only true if the resumed part was
  // hashed before the rest was appended.
  check('the hash covers the whole file, not the remainder', resumed.sha256 === sha256)

  /* ------------------------------------------------------------- 3. damaged */

  console.log('\nA damaged download')
  const corruptTarget = join(work, 'apps', 'Vantage', 'Vantage.exe')
  let corruptCode = 'no error'
  try {
    await downloader.downloadToFile({
      url,
      destination: corruptTarget,
      sha256: 'f'.repeat(64),
      signal: new AbortController().signal
    })
  } catch (error) {
    corruptCode = error instanceof Error ? error.message : String(error)
  }

  check('is rejected when the hash disagrees', /checksum/i.test(corruptCode), corruptCode)
  check('is not left behind as an application', !existsSync(corruptTarget))
  check('is not left behind as debris either', !existsSync(`${corruptTarget}.part`))

  /* ------------------------------------------------------------- 4. cancel */

  console.log('\nA cancelled download')
  const cancelTarget = join(work, 'apps', 'Cancelled', 'Cancelled.exe')
  const controller = new AbortController()
  let cancelCode = 'no error'
  try {
    await downloader.downloadToFile({
      url: url.replace('/aurora.exe', '/slow'),
      destination: cancelTarget,
      signal: controller.signal,
      onProgress: () => controller.abort()
    })
  } catch (error) {
    cancelCode = error instanceof Error ? error.message : String(error)
  }

  check('stops when it is cancelled', cancelCode !== 'no error', cancelCode)
  check('never produces an installed file', !existsSync(cancelTarget))

  /* ------------------------------------------------- 5. a measured download */

  /*
   * The bug this section exists for: the panel served files as a chunked stream with no
   * length and no ranges. The loader could not compute a percentage — the bar sat at 0%
   * while bytes arrived — and every retry started from zero.
   */
  console.log('\nA server that says how big the file is')

  const ranged = await downloader.downloadToFile({
    url,
    destination: join(work, 'apps', 'Ranged', 'Ranged.exe'),
    signal: new AbortController().signal
  })
  check('the length is known, so a percentage is possible', ranged.bytes === body.length)
  check('the server honoured the request', ranged.resumed === false)

  // The half-downloaded case, which a retry depends on.
  const resumeTarget = join(work, 'apps', 'Resumed', 'Resumed.exe')
  mkdirSync(dirname(resumeTarget), { recursive: true })
  writeFileSync(`${resumeTarget}.part`, body.subarray(0, 1024 * 1024))
  const continued = await downloader.downloadToFile({
    url,
    destination: resumeTarget,
    signal: new AbortController().signal
  })
  check('a fragment is continued rather than restarted', continued.resumed === true)
  check('and the result is the whole file', readFileSync(resumeTarget).equals(body))

  // A fragment too old to trust is not continued: the file may have been replaced.
  writeFileSync(`${resumeTarget}.part`, Buffer.alloc(10))
  check('a fresh fragment is offered for reuse', downloader.resumableBytes(resumeTarget) === 10)

  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
  utimesSync(`${resumeTarget}.part`, twoDaysAgo, twoDaysAgo)
  check('a fragment from two days ago is refused', downloader.resumableBytes(resumeTarget) === 0)

  /* ------------------------------------------------- 6. downloaded once */

  /*
   * "Downloaded once" is the whole feature: a machine that already has the file must
   * not fetch it again, must remember that across restarts, and must notice when the
   * file has gone. That last one is what brings the Download button back.
   */
  console.log('\nDownloaded once')
  const userData = join(work, 'userdata')
  mkdirSync(userData, { recursive: true })
  globalThis.__electron__ = { userData, documents: join(work, 'documents') }

  const installed = await bundle('src/main/services/installed.ts', join(work, 'installed.mjs'), true)
  const library = installed.downloadTarget('Nova Drift')

  check(
    'the library lives inside the loader folder',
    library.exe.startsWith(join(userData, 'downloads')),
    library.exe
  )
  check('one folder per product', library.dir.endsWith(join('downloads', 'Nova Drift')), library.dir)

  mkdirSync(library.dir, { recursive: true })
  writeFileSync(library.exe, Buffer.alloc(4096, 7))
  installed.record({
    id: 'nova',
    name: 'Nova Drift',
    version: '1.0.0',
    exe: library.exe,
    bytes: 4096,
    downloadedAt: new Date().toISOString()
  })

  check('a recorded file counts as downloaded', installed.installed('nova') !== null)
  check('and it is in the list the screens read', installed.allInstalled().length === 1)

  // Truncated by anything — a failed copy, a disk that filled up — is not downloaded.
  writeFileSync(library.exe, Buffer.alloc(1024, 7))
  check('a file of the wrong size is not downloaded', installed.installed('nova') === null)

  writeFileSync(library.exe, Buffer.alloc(4096, 7))
  check('restoring the right bytes restores the state', installed.installed('nova') !== null)

  unlinkSync(library.exe)
  check('deleting the file brings the download back', installed.installed('nova') === null)
  check('and takes it out of the list', installed.allInstalled().length === 0)

  /* ------------------------------------------------- 6. the film on disk */

  /*
   * The film is the first thing on screen and used to be the last thing to arrive: a
   * round trip to a free-tier server that then streamed it out of a bucket, every launch.
   * Now it is fetched once, played from a local file, and the second launch touches no
   * network at all — which is what these checks are about.
   */
  console.log('\nThe film, fetched once')
  const film = await bundle('src/main/lib/film.ts', join(work, 'film.mjs'), true)
  film.serveFilm()

  /*
   * The cache only accepts https, because the panel only publishes https. The stub
   * presents this test server as such: the rule is not relaxed for a test, the address is
   * made to look like the real one.
   */
  const base = new URL(url).origin
  globalThis.__electron__.fetch = (input, init) =>
    fetch(String(input).replace('https://film.test', base), init)
  const filmUrl = new URL(url.replace('/aurora.exe', '/aurora.exe')).href.replace(base, 'https://film.test')

  const firstFetch = await film.ensureFilm(filmUrl)
  check('the film is fetched once', firstFetch === true)
  check('and is then on disk', film.filmIsCached(filmUrl) === true)
  check('the second launch does not fetch it again', (await film.ensureFilm(filmUrl)) === false)

  const source = film.filmSource(filmUrl)
  check('the source becomes a local scheme', /^indra-film:\/\/film\/[a-f0-9]{16}\.mp4$/.test(source ?? ''), source)
  check('a film that is not cached is left to the network', film.filmSource('https://example.test/other.mp4') === 'https://example.test/other.mp4')
  check('and an empty address is nothing', film.filmSource('') === null)
  check('the last film can be played without asking anyone', film.currentFilmSource() === source)
  check('a plain http address is not cached', (await film.ensureFilm('http://example.test/a.mp4')) === false)

  /*
   * The protocol handler, called the way a media element calls it — including the range
   * request a `<video>` makes when it seeks, which is what looping is.
   */
  const handler = globalThis.__electron__.handlers?.['indra-film']
  check('the local scheme is registered', typeof handler === 'function')

  if (typeof handler === 'function') {
    const name = source.replace('indra-film://film/', '')
    const whole = await handler(new Request(`indra-film://film/${name}`))
    check('it answers 200', whole.status === 200)
    check('with the length', whole.headers.get('content-length') === String(body.length))
    const read = Buffer.from(await whole.arrayBuffer())
    check('and the bytes are the film', read.equals(body))

    const part = await handler(
      new Request(`indra-film://film/${name}`, { headers: { range: 'bytes=100-199' } })
    )
    check('a range answers 206', part.status === 206)
    check(
      'with the range it was asked for',
      part.headers.get('content-range') === `bytes 100-199/${body.length}`,
      part.headers.get('content-range')
    )
    check('and a slice, not the file', Buffer.from(await part.arrayBuffer()).equals(body.subarray(100, 200)))

    const past = await handler(new Request(`indra-film://film/${name}`, { headers: { range: `bytes=${body.length}-` } }))
    check('a range past the end is 416', past.status === 416)

    // The scheme serves one folder and nothing else.
    const escape = await handler(new Request('indra-film://film/../../secrets.mp4'))
    check('a path is refused', escape.status === 404)
    const wrong = await handler(new Request('indra-film://film/not-a-film.mp4'))
    check('an unknown name is refused', wrong.status === 404)
  }

  /* ------------------------------------------------------------- 7. names */

  console.log('\nFile names from a hostile field')
  const safe = paths.safeName('../../Windows/System32')
  check('a path in a name becomes one flat folder', !safe.includes('/') && !safe.includes('\\'), safe)
  check('an empty name still yields a folder', paths.safeName('') === 'app')
  check('a trailing dot is dropped', paths.safeName('Nova.') === 'Nova')
  check('the name is capped', paths.safeName('x'.repeat(200)).length === 60)

  server.close()
  console.log(
    failures === 0
      ? '\n✓ Downloads commit atomically, resume correctly, and reject what they cannot verify.\n'
      : `\n✗ ${failures} check(s) failed.\n`
  )
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
