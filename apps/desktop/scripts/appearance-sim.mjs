/**
 * Proves the sign-in background video pipeline end to end, without a window.
 *
 * What this checks:
 *   1. a real MP4 (container header, not just a matching extension) installs
 *   2. the bytes are copied into <userData>/media and recorded in the database
 *   3. the bytes can be read back for the renderer, with the right mime type
 *   4. the signed-out payload carries an asset id and never a file name or path
 *   5. a text file renamed .mp4, an .avi, an empty file, an H.265 file and an
 *      oversized file are all refused with a message a person can act on
 *   6. the panel's health check reports a readable file, and a missing one
 *   7. replacing the video removes the old file and leaves one row
 *   8. blur and dim are clamped, not trusted
 *   9. removing the video clears the setting, the row and the file
 *
 * Playback itself is not testable in Node; scripts/login-video-harness proves
 * that half in Chromium. This proves everything up to the hand-off.
 *
 *   npm run sim:appearance
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs'
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

/** An MP4 whose sample description says H.265 — Chrome would show black. */
function fakeHevc(size = 8192) {
  const buffer = fakeMp4(size)
  buffer.write('hvc1', 1024, 'latin1')
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
  getVersion: () => '1.5.2',
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
  if (!files[0].startsWith(installed.background.id)) {
    return fail(`the media file is not named after its record (${files[0]})`)
  }
  ok('the video is copied into the media folder and recorded in the database')

  // ---- 3. the renderer's bytes ----------------------------------------
  const handed = appearance.readLoginBackgroundFile()
  if (!handed) return fail('the renderer would receive no bytes at all')
  if (handed.mime !== 'video/mp4') return fail(`the renderer would receive ${handed.mime}`)
  if (Buffer.from(handed.bytes).length !== 4096) {
    return fail(`handed over ${handed.bytes.length} bytes, expected 4096`)
  }
  if (Buffer.from(handed.bytes).subarray(4, 8).toString('latin1') !== 'ftyp') {
    return fail('the bytes handed to the renderer are not the video')
  }
  ok('the exact bytes are readable, ready to become a Blob URL')

  // ---- 4. the public payload hides the file name -----------------------
  const publicPayload = appearance.publicAppearance()
  if (publicPayload.assetId !== installed.background.id) {
    return fail('the public payload does not carry the asset id')
  }
  if (!publicPayload.hasVideo) return fail('the public payload does not say a video is installed')
  if (publicPayload.mime !== 'video/mp4') return fail('the public payload lost the mime type')
  if ('originalName' in publicPayload) return fail('the public payload leaks the file name')
  ok('signed-out screens receive an asset id, never a file name or a path')

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

  const empty = join(work, 'empty.mp4')
  writeFileSync(empty, '')
  try {
    appearance.installLoginBackground(empty, 'empty.mp4')
    fail('an empty file was accepted')
  } catch (error) {
    if (error?.code !== 'VALIDATION') fail(`unexpected error for an empty file: ${error?.code}`)
    else ok('an empty file is refused')
  }

  const hevc = join(work, 'phone.mp4')
  writeFileSync(hevc, fakeHevc())
  try {
    appearance.installLoginBackground(hevc, 'phone.mp4')
    fail('an H.265 video was accepted and would have played as a black screen')
  } catch (error) {
    if (error?.code !== 'VALIDATION') {
      fail(`unexpected error for an H.265 video: ${error?.code}`)
    } else if (!/H\.265|HEVC/.test(error.message)) {
      fail(`the H.265 refusal does not name the codec: ${error.message}`)
    } else {
      ok('H.265 / HEVC is refused at upload, by name')
    }
  }

  const huge = join(work, 'huge.mp4')
  writeFileSync(huge, fakeMp4())
  truncateSync(huge, 97 * 1024 * 1024)
  try {
    appearance.installLoginBackground(huge, 'huge.mp4')
    fail('a 97 MB video was accepted')
  } catch (error) {
    if (error?.code !== 'VALIDATION') fail(`unexpected error for an oversized file: ${error?.code}`)
    else ok('a video over the size limit is refused')
  }

  // ---- 6. the panel's health check -------------------------------------
  const healthy = appearance.backgroundHealth()
  if (!healthy.present || !healthy.readable) {
    return fail(`the health check did not see a readable file: ${JSON.stringify(healthy)}`)
  }
  if (healthy.bytes !== statSync(join(media, readdirSync(media)[0])).size) {
    return fail('the health check reported the wrong size')
  }
  ok('the health check reports the installed file as readable')

  // ---- 7. replacing removes the old file -------------------------------
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

  // A file that vanished between the record and the read is not a crash: the
  // sign-in screen should fall back to the plain canvas and the panel should
  // say so.
  const liveFile = join(media, afterReplace[0])
  unlinkSync(liveFile)
  const broken = appearance.backgroundHealth()
  if (!broken.present) return fail('a removed file is reported as no video at all')
  if (broken.readable) return fail('a missing file is still reported as readable')
  if (appearance.readLoginBackgroundFile() !== null) {
    return fail('the renderer would receive bytes for a missing file')
  }
  ok('a file that disappeared is reported as unreadable, not as a crash')

  // ---- 8. treatment is clamped -----------------------------------------
  const clamped = appearance.writeTreatment({ blur: 999, dim: -10 })
  if (clamped.blur !== 40) return fail(`blur was not clamped (${clamped.blur})`)
  if (clamped.dim !== 0) return fail(`dim was not clamped (${clamped.dim})`)
  const tuned = appearance.writeTreatment({ blur: 12, dim: 66 })
  if (tuned.blur !== 12 || tuned.dim !== 66) return fail('treatment did not persist')
  const reread = appearance.readLoginAppearance()
  if (reread.blur !== 12 || reread.dim !== 66) return fail('treatment did not survive a re-read')
  ok('blur and dim are clamped and persisted')

  // ---- 9. removing clears everything -----------------------------------
  const cleared = appearance.removeLoginBackground()
  if (cleared.background) return fail('removing the video left a background behind')
  if (readdirSync(media).length !== 0) return fail('the media folder still holds a file')
  if (appearance.publicAppearance().hasVideo || appearance.publicAppearance().assetId !== null) {
    return fail('the public payload still advertises a video')
  }
  if (appearance.readLoginBackgroundFile() !== null) {
    return fail('the renderer would still receive bytes after a removal')
  }
  ok('removing the video clears the setting, the row and the file')

  console.log('')
  if (failures === 0) console.log('appearance pipeline: all checks passed')
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
