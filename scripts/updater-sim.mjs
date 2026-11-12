/**
 * End-to-end simulation of an in-app update, without a window.
 *
 * The updater talks to `fs` and to `electron`, and Electron's asar layer
 * rewrites any path containing ".asar" — a trap that quietly broke every update
 * for four releases while every unit-level check passed. This script exists so
 * that trap can never come back unnoticed: it bundles the real updater, runs it
 * against a real `.asar` payload served over HTTP, with a faithful copy of the
 * asar layer switched on, and then asks the bootstrap whether it would run what
 * was downloaded.
 *
 *   npm run sim:update
 *
 * Nothing here is connected to the release workflow; it is a local proof.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'
import * as asar from '@electron/asar'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-updater-sim')
const userData = join(work, 'userdata')

function fail(message) {
  console.error(`\n✗ ${message}`)
  process.exitCode = 1
}

/** Writes the electron stand-in and an asar layer that behaves like Electron 45. */
function writeStubs(dir) {
  mkdirSync(join(dir, 'node_modules', 'electron'), { recursive: true })
  writeFileSync(
    join(dir, 'node_modules', 'electron', 'package.json'),
    JSON.stringify({ name: 'electron', version: '45.0.0', main: 'index.js' })
  )
  writeFileSync(
    join(dir, 'node_modules', 'electron', 'index.js'),
    `const app = {
  isPackaged: true,
  getVersion: () => '1.3.4',
  getPath: () => ${JSON.stringify(userData)},
  relaunch: () => {},
  exit: () => {},
  whenReady: () => Promise.resolve()
}
module.exports = {
  app,
  net: { fetch: (url, init) => globalThis.__simFetch(String(url), init) },
  BrowserWindow: { getAllWindows: () => [] }
}
`
  )

  writeFileSync(
    join(dir, 'asar-shim.cjs'),
    `const fs = require('fs')
const path = require('path')
const realExists = fs.existsSync.bind(fs)
const split = (p) => {
  if (process.noAsar || typeof p !== 'string' || !/\\.asar/i.test(p)) return null
  const n = path.normalize(p)
  const i = n.toLowerCase().indexOf('.asar')
  return { asarPath: n.slice(0, i + 5), filePath: n.slice(i + 5).replace(/^[\\\\/]+|[\\\\/]+$/g, '') }
}
const fail = (i) => {
  if (!realExists(i.asarPath)) return new Error('Invalid package ' + i.asarPath)
  const e = new Error('ENOENT, ' + i.filePath + ' not found in ' + i.asarPath)
  e.code = 'ENOENT'
  return e
}
const guard = (fn) => function (p, ...rest) {
  const i = split(p)
  return i ? (() => { throw fail(i) })() : fn.call(this, p, ...rest)
}
const guardAsync = (fn) => function (p, ...rest) {
  const i = split(p)
  if (!i) return fn.call(this, p, ...rest)
  const cb = rest[rest.length - 1]
  if (typeof cb === 'function') return cb(fail(i))
  throw fail(i)
}
const guardPromise = (fn) => async function (p, ...rest) {
  const i = split(p)
  if (i) throw fail(i)
  return fn.call(this, p, ...rest)
}
module.exports = () => {
  fs.statSync = guard(fs.statSync)
  fs.lstatSync = guard(fs.lstatSync)
  fs.readFileSync = guard(fs.readFileSync)
  fs.accessSync = guard(fs.accessSync)
  fs.stat = guardAsync(fs.stat)
  fs.lstat = guardAsync(fs.lstat)
  fs.readFile = guardAsync(fs.readFile)
  fs.access = guardAsync(fs.access)
  fs.promises.stat = guardPromise(fs.promises.stat)
  fs.promises.lstat = guardPromise(fs.promises.lstat)
  fs.promises.readFile = guardPromise(fs.promises.readFile)
  fs.promises.access = guardPromise(fs.promises.access)
}
`
  )
}

async function bundle(entry, outfile) {
  await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile,
    logLevel: 'warning'
  })
}

async function main() {
  rmSync(work, { recursive: true, force: true })
  const staging = join(work, 'staging')
  for (const dir of ['main', 'preload', 'renderer']) {
    mkdirSync(join(staging, dir), { recursive: true })
  }
  writeFileSync(join(staging, 'main', 'index.js'), 'module.exports = 1\n')
  writeFileSync(join(staging, 'preload', 'index.js'), '// preload\n')
  writeFileSync(join(staging, 'renderer', 'index.html'), '<!doctype html><html></html>')

  const name = 'INDRA-HUB-Payload-1.3.5.asar'
  const archive = join(work, name)
  await asar.createPackage(staging, archive)
  const bytes = readFileSync(archive)

  const manifest = {
    version: '1.3.5',
    file: name,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    url: `https://github.com/TejHorwDev/INDRA-HUB/releases/download/v1.3.5/${name}`
  }

  const server = createServer((request, response) => {
    if ((request.url ?? '').endsWith('/payload.json')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(manifest))
      return
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length })
    response.end(bytes)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  globalThis.__simFetch = async (url) => {
    const local = url.includes('payload.json')
      ? `http://127.0.0.1:${port}/payload.json`
      : `http://127.0.0.1:${port}/asset`
    const response = await fetch(local)
    return new Response(response.body, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') ?? '',
        'content-length': response.headers.get('content-length') ?? ''
      }
    })
  }

  writeStubs(work)
  await bundle('src/main/services/updates.ts', join(work, 'updates.cjs'))
  await bundle('src/main/lib/payload.ts', join(work, 'payload.cjs'))

  // Debris from an earlier, failed attempt must not matter. Note that no
  // `.asar` is created here on purpose: the first download finds nothing to
  // delete, which is the case that used to throw "Invalid package".
  mkdirSync(join(userData, 'update'), { recursive: true })
  writeFileSync(join(userData, 'update', 'incoming-leftover.download'), 'junk')

  const require_ = createRequire(join(work, 'index.js'))
  require_(join(work, 'asar-shim.cjs'))()

  const updates = require_(join(work, 'updates.cjs'))
  const state = await updates.checkForUpdates(true)
  server.close()

  if (state.phase !== 'ready') {
    fail(`the check ended in "${state.phase}": ${state.message}${state.detail ? ` (${state.detail})` : ''}`)
    return
  }

  const payload = require_(join(work, 'payload.cjs'))
  const adopted = payload.resolveActivePayload()
  if (!adopted || adopted.version !== '1.3.5') {
    fail('the bootstrap would not have run what was downloaded')
    return
  }

  console.log('✓ check → 1.3.5 downloaded, verified and marked ready')
  console.log('✓ bootstrap → would run', adopted.path)
  console.log('✓ running version reported as', payload.runningVersion())
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
