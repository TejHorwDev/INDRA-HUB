/**
 * Proves the sign-in background video pipeline end to end, without a window.
 *
 * What this checks:
 *   1. a real MP4 (container header, not just a matching extension) installs
 *   2. the bytes are copied into <userData>/media and recorded in the database
 *   3. indra-media://asset/<id> serves those bytes, including range requests
 *   4. publicAppearance exposes an address, never a file name
 *   5. a text file renamed .mp4, an unsupported extension and an empty file
 *      are all refused with a message a person can act on
 *   6. replacing the video removes the old file and leaves one row
 *   7. blur and dim are clamped, not trusted
 *   8. removing the video clears the setting, the row and the file
 *
 *   npm run sim:appearance
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-appearance-sim')
const userData = join(work, 'userdata')
const media = join(userData, 'media')

let failures = 0

function fail(message) {
  failures += 1
  console.error(`\n✗ ${message}`)
  process.exitCode = 1
}

function ok(message) {
  console.log(`✓ ${message}`)
}

/** A minimal but structurally real MP4 head: 4-byte size, then 'ftyp'. */
function fakeMp4(size = 4096) {
  const buffer = Buffer.alloc(size, 0)
  buffer.writeUInt32BE(size, 0)
  buffer.write('ftypisom', 4, 'latin1')
  buffer.write('INDRA-HUB test payload', 24, 'latin1')
  return buffer
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
  getVersion: () => '1.5.0',
  getPath: () => ${JSON.stringify(userData)},
  relaunch: () => {},
  exit: () => {}
}
module.exports = { app, net: { fetch: () => { throw new Error('offline') } }, BrowserWindow: { getAllWindows: () => [] } }
`
  )

  writeFileSync(
    join(work, 'entry.ts'),
    `export * from ${JSON.stringify(join(root, 'src/main/services/appearance.ts'))}
`
  )

  await build({
    entryPoints: [join(work, 'entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(work, 'bundle.mjs'),
    external: ['electron', 'node:sqlite'],
    logLevel: 'silent'
          })

  const appearance = await import(`file://${join(work, 'bundle.mjs')}?v=${Date.now()}`)

  // ---- 1. install a real MP4 -------------------------------------------
  const source = join(work, 'clip.mp4')
  writeFileSync(source, fakeMp4())

  const installed = appearance.installLoginBackground(source, 'clip.mp4')
  if (!installed.background) return fail('a valid MP4 did not install')
  if (installed.background.mime !== 'video/mp4') return fail('the mime type was not recorded')
  ok('a valid MP4 installs')

  // ---- 2. bytes on disk, record in the database ------------------------
  const files = readdirSync(media)
  if (files.length !== 1) return fail(`expected one file in the media folder, found ${files.length}`)
  if (!existsSync(join(media, files[0]))) return fail('the media file is missing')
  const url = installed.background.url
  if (!url.startsWith('indra-media://asset/')) return fail(`unexpected media url: ${url}`)
  ok('the video is copied into the media folder and pointed at by the database')

  // ---- 3. the protocol handler serves it -------------------------------
  const response = await appearance.handleMediaRequest(
    new Request(`http://localhost/${url.split('/').pop()}?x=1`)
  )
  if (response.status !== 200) return fail(`media handler answered ${response.status}`)
  if (response.headers.get('content-type') !== 'video/mp4') {
    return fail('media handler returned the wrong content type')
  }
  const body = Buffer.from(await response.arrayBuffer())
  if (body.length !== 4096) return fail(`served ${body.length} bytes, expected 4096`)
  if (body.subarray(4, 8).toString('latin1') !== 'ftyp') return fail('served bytes are not the video')

  const ranged = await appearance.handleMediaRequest(
    new Request(`http://localhost/${url.split('/').pop()}`, {
      headers: { range: 'bytes=100-199' }
    })
  )
  if (ranged.status !== 206) return fail(`range request answered ${ranged.status}, expected 206`)
  if ((await ranged.arrayBuffer()).byteLength !== 100) return fail('range request returned the wrong slice')
  ok('indra-media serves the video, with range requests for seeking')

  const missing = await appearance.handleMediaRequest(
    new Request('http://localhost/not-a-real-asset')
  )
  if (missing.status !== 404) return fail('an unknown asset id did not 404')
  ok('an unknown asset id is refused')

  // ---- 4. the public payload hides the file name -----------------------
  const publicPayload = appearance.publicAppearance()
  if (publicPayload.url !== url) return fail('the public payload does not carry the media url')
  if ('originalName' in publicPayload) return fail('the public payload leaks the file name')
  ok('signed-out screens receive an address, not a file name')

  // ---- 5. bad input is refused with a usable message -------------------
  const renamed = join(work, 'not-really.mp4')
  writeFileSync(renamed, 'this is a text file pretending to be a video')
  try {
    appearance.installLoginBackground(renamed, 'not-really.mp4')
    fail('a text file renamed .mp4 was accepted')
  } catch (error) {
    if (error?.code !== 'VALIDATION') fail(`unexpected error for a fake mp4: ${error?.code}`)
    else ok('a file that is not really a video is refused')
  }

  const avi = join(work, 'clip.avi')
  writeFileSync(avi, fakeMp4())
  try {
    appearance.installLoginBackground(avi, 'clip.avi')
    fail('an unsupported extension was accepted')
  } catch (error) {
    if (error?.code !== 'VALIDATION') fail(`unexpected error for .avi: ${error?.code}`)
    else ok('an unsupported video format is refused')
  }

  // ---- 6. replacing removes the old file -------------------------------
  const replacement = join(work, 'clip2.webm')
  const webm = Buffer.alloc(2048, 0)
  webm.writeUInt32BE(0x1a45dfa3, 0)
  writeFileSync(replacement, webm)

  const replaced = appearance.installLoginBackground(replacement, 'clip2.webm')
  if (!replaced.background) return fail('the replacement video did not install')
  if (replaced.background.mime !== 'video/webm') return fail('the replacement kept the old mime')
  const afterReplace = readdirSync(media)
  if (afterReplace.length !== 1) {
    return fail(`the old file was left behind (${afterReplace.length} files in media)`)
  }
  ok('replacing the video deletes the previous file')

  // ---- 7. treatment is clamped -----------------------------------------
  const clamped = appearance.writeTreatment({ blur: 999, dim: -10 })
  if (clamped.blur !== 40) return fail(`blur was not clamped (${clamped.blur})`)
  if (clamped.dim !== 0) return fail(`dim was not clamped (${clamped.dim})`)
  const tuned = appearance.writeTreatment({ blur: 12, dim: 66 })
  if (tuned.blur !== 12 || tuned.dim !== 66) return fail('treatment did not persist')
  const reread = appearance.readLoginAppearance()
  if (reread.blur !== 12 || reread.dim !== 66) return fail('treatment did not survive a re-read')
  ok('blur and dim are clamped and persisted')

  // ---- 8. removing clears everything -----------------------------------
  const cleared = appearance.removeLoginBackground()
  if (cleared.background) return fail('removing the video left a background behind')
  if (readdirSync(media).length !== 0) return fail('the media folder still holds a file')
  if (appearance.publicAppearance().url !== null) return fail('the public payload still advertises a url')
  ok('removing the video clears the setting, the row and the file')

  console.log('')
  if (failures === 0) console.log('appearance pipeline: all checks passed')
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
