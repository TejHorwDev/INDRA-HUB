/**
 * Proves the shared-workspace path without a network or a window.
 *
 * A faithful little Supabase stands in for the real one: GoTrue for sign-up and
 * sign-in, PostgREST for the workspace row (with the same ownership rules as
 * the SQL policies), Storage for the video, and a WebSocket that pushes row
 * changes. The real `workspace.ts` is bundled and pointed at it, so what is
 * tested is the client that ships, not a copy of it.
 *
 * What this checks:
 *   1. a fresh installation with an empty database picks up the shared row
 *   2. a machine that is not signed in keeps the mirror and publishes nothing
 *   3. signing in, claiming with the right code and publishing a change
 *   4. a change pushed from another machine arrives over the socket and is
 *      applied — including a video that has to be downloaded
 *   5. a stale push loses to the newer row instead of overwriting it
 *   6. hostile payloads are clamped or refused, never stored raw
 *   7. with the network gone the app keeps running on its local copy
 *   8. a deliberate disconnect is not undone on the next launch
 *
 *   npm run sim:workspace
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-workspace-sim')
const userData = join(work, 'userdata')
const media = join(userData, 'media')

let failures = 0
const ok = (message) => console.log(`✓ ${message}`)
const fail = (message) => {
  failures += 1
  console.error(`\n✗ ${message}`)
  process.exitCode = 1
}
const check = (condition, message, detail = '') => {
  if (condition) ok(message)
  else fail(`${message}${detail ? ` — ${detail}` : ''}`)
}

const sha256 = async (value) => {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(value).digest('hex')
}

const CLAIM_CODE = 'IH-TEST-CODE-0001'
const OWNER_EMAIL = 'owner@example.test'
const OWNER_PASSWORD = 'correct horse battery staple'
const OWNER_UID = '11111111-1111-1111-1111-111111111111'

/* ------------------------------------------------------------------ */
/* A small, faithful Supabase                                          */
/* ------------------------------------------------------------------ */

const server = {
  row: {
    id: 'primary',
    owner_uid: null,
    revision: 1,
    allow_registration: true,
    maintenance: false,
    maintenance_message: 'INDRA HUB is temporarily unavailable while maintenance is carried out.',
    require_activation_key: false,
    background_asset_id: null,
    background_mime: null,
    background_bytes: 0,
    background_path: null,
    background_blur: 18,
    background_dim: 46,
    claim_hash: null,
    updated_at: new Date().toISOString()
  },
  objects: new Map(),
  tokens: new Map(),
  offline: false,
  lastPatchAt: 0
}

function view() {
  const { claim_hash, owner_uid, ...rest } = server.row
  return {
    ...rest,
    owned: Boolean(owner_uid),
    owned_by_me: false, // filled per caller below
    claimable: Boolean(claim_hash)
  }
}

function uidFromAuth(request) {
  const header = request.headers.get('authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '')
  return server.tokens.get(token) ?? null
}

function bump(patch) {
  Object.assign(server.row, patch)
  server.row.revision += 1
  server.row.updated_at = new Date().toISOString()
  server.lastPatchAt = Date.now()
  return view()
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function fakeFetch(input, init = {}) {
  if (server.offline) throw new Error('offline')
  const url = new URL(String(input))
  const path = url.pathname
  const method = (init.method ?? 'GET').toUpperCase()
  const request = new Request(url, { method, headers: init.headers, body: init.body })

  /* GoTrue */
  if (path === '/auth/v1/signup' && method === 'POST') {
    const body = JSON.parse(String(init.body))
    if (body.email !== OWNER_EMAIL) return json({ msg: 'signup disabled for this test address' }, 400)
    const token = `access-${Date.now()}`
    server.tokens.set(token, OWNER_UID)
    return json({
      access_token: token,
      refresh_token: 'refresh-1',
      expires_in: 3600,
      user: { id: OWNER_UID, email: OWNER_EMAIL }
    })
  }

  if (path === '/auth/v1/token' && method === 'POST') {
    const body = JSON.parse(String(init.body))
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      const token = `access-${Date.now()}`
      server.tokens.set(token, OWNER_UID)
      return json({
        access_token: token,
        refresh_token: 'refresh-2',
        expires_in: 3600,
        user: { id: OWNER_UID, email: OWNER_EMAIL }
      })
    }
    if (body.password !== OWNER_PASSWORD) return json({ msg: 'Invalid login credentials' }, 400)
    const token = `access-${Date.now()}`
    server.tokens.set(token, OWNER_UID)
    return json({
      access_token: token,
      refresh_token: 'refresh-1',
      expires_in: 3600,
      user: { id: OWNER_UID, email: OWNER_EMAIL }
    })
  }

  /* PostgREST: the view every installation reads */
  if (path === '/rest/v1/indra_workspace_state' && method === 'GET') {
    const uid = uidFromAuth(request)
    return json([{ ...view(), owned_by_me: Boolean(uid && uid === server.row.owner_uid) }])
  }

  /* PostgREST: the writes, under the same rules as the RLS policy */
  if (path === '/rest/v1/indra_workspace' && method === 'PATCH') {
    const uid = uidFromAuth(request)
    if (!uid) return json({ message: 'permission denied' }, 401)
    if (!server.row.owner_uid || server.row.owner_uid !== uid) {
      return json({ message: 'permission denied for table indra_workspace' }, 403)
    }
    if (server.conflictOnce) {
      server.conflictOnce = false
      return json([], 200)
    }
    const wanted = Number(url.searchParams.get('revision').replace('eq.', ''))
    if (wanted !== server.row.revision) return json([], 200)
    const patch = JSON.parse(String(init.body))
    const next = bump(patch)
    return json([{ ...next, owned_by_me: true }])
  }

  /* The claim function */
  if (path === '/rest/v1/rpc/indra_claim_workspace' && method === 'POST') {
    const uid = uidFromAuth(request)
    if (!uid) return json({ message: 'not signed in' }, 401)
    const { p_code: code } = JSON.parse(String(init.body))
    const hash = await sha256(`${code}indra-claim-v1`)
    if (server.row.owner_uid || !server.row.claim_hash || server.row.claim_hash !== hash) {
      return json(false)
    }
    bump({ owner_uid: uid, claim_hash: null })
    return json(true)
  }

  /* Storage */
  if (path.startsWith('/storage/v1/object/') && method === 'POST') {
    const uid = uidFromAuth(request)
    if (!uid || uid !== server.row.owner_uid) return json({ message: 'denied' }, 403)
    const objectPath = decodeURIComponent(path.replace('/storage/v1/object/indra-media/', ''))
    const bytes = Buffer.from(await new Response(init.body).arrayBuffer())
    if (bytes.length > 100663296) return json({ message: 'too large' }, 413)
    server.objects.set(objectPath, bytes)
    return json({ Key: objectPath })
  }

  if (path.startsWith('/storage/v1/object/authenticated/indra-media/') && method === 'GET') {
    const objectPath = decodeURIComponent(path.replace('/storage/v1/object/authenticated/indra-media/', ''))
    const bytes = server.objects.get(objectPath)
    if (!bytes) return json({ message: 'not found' }, 404)
    return new Response(bytes, { status: 200, headers: { 'content-type': 'video/mp4' } })
  }

  if (path.startsWith('/storage/v1/object/indra-media/') && method === 'DELETE') {
    const objectPath = decodeURIComponent(path.replace('/storage/v1/object/indra-media/', ''))
    server.objects.delete(objectPath)
    return json({})
  }

  return json({ message: `unhandled ${method} ${path}` }, 404)
}

/* A WebSocket that only has to deliver one kind of message. */
const sockets = new Set()

class FakeWebSocket {
  constructor(url) {
    this.url = url
    this.listeners = new Map()
    this.closed = false
    sockets.add(this)
    setTimeout(() => this.emit('open', {}), 0)
  }
  addEventListener(name, handler) {
    const list = this.listeners.get(name) ?? []
    list.push(handler)
    this.listeners.set(name, list)
  }
  send() {}
  close() {
    this.closed = true
    sockets.delete(this)
    this.emit('close', {})
  }
  emit(name, event) {
    for (const handler of this.listeners.get(name) ?? []) handler(event)
  }
}

function pushRealtimeChange() {
  for (const socket of sockets) {
    socket.emit('message', {
      data: JSON.stringify({ event: 'postgres_changes', payload: { data: { type: 'UPDATE' } } })
    })
  }
}

/* ------------------------------------------------------------------ */
/* Booting the real client                                             */
/* ------------------------------------------------------------------ */

const broadcasts = []

async function prepareBundle() {
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
  getVersion: () => '1.6.0',
  getPath: () => ${JSON.stringify(userData)},
  relaunch: () => {},
  exit: () => {}
}
const fakeWindow = {
  isDestroyed: () => false,
  webContents: { send: (channel, payload) => globalThis.__broadcast(channel, payload) }
}
const BrowserWindow = { getAllWindows: () => [fakeWindow] }
const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (value) => Buffer.from(value),
  decryptString: (buffer) => buffer.toString()
}
module.exports = { app, BrowserWindow, safeStorage, net: { fetch: () => { throw new Error('offline') } } }
`
  )

  writeFileSync(
    join(work, 'entry.ts'),
    `export * from ${JSON.stringify(join(root, 'src/main/services/workspace.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/settings.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/appearance.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/backend.ts'))}
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
}

async function load() {
  const module = await import(`file://${join(work, 'bundle.mjs')}?v=${Date.now()}`)
  return module
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(predicate, label, timeout = 4000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    try {
      if (await predicate()) return true
    } catch {
      // keep waiting
    }
    await wait(40)
  }
  fail(`timed out waiting for ${label}`)
  return false
}

async function main() {
  await prepareBundle()

  globalThis.__broadcast = (channel, payload) => broadcasts.push({ channel, payload })
  globalThis.fetch = fakeFetch
  globalThis.WebSocket = FakeWebSocket

  // Seeded exactly as supabase/workspace.sql seeds the project: the setup code
  // exists only as a hash, and only one account can ever claim it.
  server.row.claim_hash = await sha256(`${CLAIM_CODE}indra-claim-v1`)

  const api = await load()

  /* ---- 1. before anyone claims it, the row overrules nobody -------- */
  const seeded = api.ensureBuiltInWorkspace()
  check(seeded.seeded === true, 'a fresh install adopts the built-in workspace endpoint')
  api.startWorkspaceSync()

  check(api.readSettings().maintenanceMode === false, 'the untouched row starts with maintenance off')

  /*
   * The administrator configures this machine while the row is still
   * unclaimed. Nobody can write an unclaimed row, so it still holds the values
   * the project shipped with — and 1.6.0 applied them anyway, which is how the
   * first sign-in video upload after that release disappeared within a minute.
   */
  api.writeSettings({
    ...api.readSettings(),
    maintenanceMode: true,
    allowRegistration: false,
    maintenanceMessage: 'Local decision.'
  })

  const localVideoPath = join(userData, 'local-loop.mp4')
  const localVideo = Buffer.alloc(2048, 3)
  localVideo.writeUInt32BE(2048, 0)
  localVideo.write('ftypisom', 4, 'latin1')
  writeFileSync(localVideoPath, localVideo)
  api.installLoginBackground(localVideoPath, 'local-loop.mp4')
  const localAsset = api.publicAppearance().assetId
  check(Boolean(localAsset), 'the administrator can install a video on a fresh machine')

  api.queuePush()
  await api.reconcile()

  const kept = api.readSettings()
  check(kept.maintenanceMode === true, 'an unclaimed workspace never undoes this machine\'s administrator')
  check(kept.allowRegistration === false, '…including the registration switch')
  check(kept.maintenanceMessage === 'Local decision.', '…and the maintenance message')
  check(api.publicAppearance().hasVideo === true, 'a video installed here survives the unclaimed row')
  check(
    server.row.maintenance === false && server.row.background_asset_id === null,
    'and nothing was published while the row has no owner'
  )
  check(api.workspaceState().signedIn === false, 'no account is signed in yet')
  check(broadcasts.length > 0 && broadcasts[0].channel === 'workspace:changed', 'windows are told to re-read')

  /* ---- 2. signed in is not the same as owning ---------------------- */
  const signedIn = await api.signInWorkspace({ email: OWNER_EMAIL, password: OWNER_PASSWORD })
  check(signedIn.signedIn === true, 'the owner can sign in to the workspace')
  check(signedIn.owner === false && signedIn.claimable === true, 'the row is still unclaimed')

  api.writeSettings({ ...api.readSettings(), maintenanceMessage: 'Still local.' })
  api.queuePush()
  await wait(400)
  await api.reconcile()
  check(server.row.maintenance_message !== 'Still local.', 'nothing is published until the row has an owner')
  check(api.readSettings().maintenanceMessage === 'Still local.', 'and the local decision is still here')
  check(api.workspaceState().pending === false, 'nothing is left waiting to publish')

  let badClaim = ''
  try {
    await api.claimWorkspace('IH-NOT-THE-CODE')
  } catch (error) {
    badClaim = error.message
  }
  check(/not accepted|already claimed/i.test(badClaim), 'a wrong setup code is refused', badClaim)

  /* ---- 3. claiming publishes what this machine already had -------- */
  const claimed = await api.claimWorkspace(CLAIM_CODE)
  check(claimed.owner === true, 'the right setup code makes this account the owner')
  check(server.row.claim_hash === null, 'the setup code is single-use')

  await until(() => server.row.maintenance === true, 'the claim to publish')
  check(
    server.row.maintenance_message === 'Still local.',
    'claiming publishes the configuration this machine had',
    server.row.maintenance_message
  )
  check(
    server.row.maintenance === true && server.row.allow_registration === false,
    'maintenance and registration go up with it'
  )
  check(
    server.row.background_asset_id === localAsset,
    'and the video this machine had installed',
    String(server.row.background_asset_id)
  )
  check(server.objects.has(server.row.background_path), 'whose bytes are uploaded to storage')
  check(api.workspaceState().pending === false, 'the pending flag clears once it is published')

  /* ---- 4. another machine installs a different video ------------- */
  const otherVideo = Buffer.alloc(4096, 7)
  otherVideo.writeUInt32BE(4096, 0)
  otherVideo.write('ftypisom', 4, 'latin1')
  server.objects.set('background/asset-from-elsewhere.mp4', otherVideo)
  bump({
    background_asset_id: 'asset-from-elsewhere',
    background_mime: 'video/mp4',
    background_bytes: 4096,
    background_path: 'background/asset-from-elsewhere.mp4'
  })
  pushRealtimeChange()
  await until(() => api.publicAppearance().assetId === 'asset-from-elsewhere', 'the new video to arrive')

  const appearance = api.publicAppearance()
  check(appearance.assetId === 'asset-from-elsewhere', 'a video installed on another PC replaces this one')
  check(appearance.hasVideo === true && appearance.bytes === 4096, 'the mirrored video is the size the row says')
  check(readdirSync(media).length === 1, 'only one video file is kept on disk', `${readdirSync(media).length} files`)
  check(
    readFileSync(join(media, readdirSync(media)[0])).length === 4096,
    'the downloaded bytes are on disk'
  )

  /* ---- 5. a stale push loses to the newer row -------------------- */
  // The server answers "no rows updated", which is what PostgREST does when the
  // revision filter no longer matches: someone else got there first.
  bump({ maintenance: false, maintenance_message: 'Changed elsewhere while you were typing.' })
  api.writeSettings({ ...api.readSettings(), maintenanceMode: true })
  api.queuePush()
  server.conflictOnce = true
  await api.push()
  await wait(300)

  check(server.row.maintenance === false, 'the stale write did not switch maintenance on')
  check(
    server.row.maintenance_message === 'Changed elsewhere while you were typing.',
    'the newer row survives',
    server.row.maintenance_message
  )
  check(
    /changed the workspace first/i.test(api.workspaceState().lastError ?? ''),
    'the panel is told the other machine won',
    api.workspaceState().lastError ?? 'no error'
  )
  await until(() => api.readSettings().maintenanceMessage === 'Changed elsewhere while you were typing.', 'the adopted row')

  /* ---- 6. hostile payloads --------------------------------------- */
  bump({ background_blur: 900, background_dim: -50, maintenance_message: 'x'.repeat(2000) })
  await api.reconcile()
  const clamped = api.readLoginAppearance()
  check(clamped.blur === 40, 'an out-of-range blur is clamped', String(clamped.blur))
  check(clamped.dim === 0, 'an out-of-range dim is clamped', String(clamped.dim))
  check(api.readSettings().maintenanceMessage.length <= 400, 'an enormous message is truncated')

  bump({ background_mime: 'application/x-msdownload', background_path: 'background/evil.exe', background_asset_id: 'evil' })
  await api.reconcile()
  const refusal = api.workspaceState().lastError ?? ''
  check(/cannot play/i.test(refusal), 'a video with an impossible type is refused', refusal)
  check(api.publicAppearance().assetId === 'asset-from-elsewhere', 'the playable video stays on screen')

  /* ---- 7. the network goes away ---------------------------------- */
  server.offline = true
  // A dead network takes the socket with it, which is what the app sees.
  for (const socket of [...sockets]) socket.close()
  const offlineState = await api.reconcile()
  check(offlineState.transport === 'offline', 'an unreachable workspace is reported as offline')
  check(Boolean(offlineState.lastError), 'the reason is kept for the panel')
  check(api.readSettings().allowRegistration === false, 'the local mirror still answers with no network')
  check(api.publicAppearance().hasVideo === true, 'the sign-in video still plays with no network')

  server.offline = false
  await api.reconcile()

  /* ---- 8. a deliberate disconnect is not undone ------------------ */
  api.markWorkspaceOptOut(true)
  const reconfigured = api.ensureBuiltInWorkspace()
  check(reconfigured.seeded === false, 'a deliberate disconnect survives the next launch')

  api.stopWorkspaceSync()
  console.log('')
  if (failures === 0) console.log('workspace sync: all checks passed')
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
