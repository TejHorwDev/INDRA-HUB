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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

async function bundle(entry, outfile) {
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

  /* ------------------------------------------------------------- 5. names */

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
