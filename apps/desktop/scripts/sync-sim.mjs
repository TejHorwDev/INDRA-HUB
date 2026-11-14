/**
 * Automatic saving, end to end, without a window and without a network.
 *
 * A small Supabase stands in for the real project: GoTrue for the account and
 * PostgREST as an in-memory set of tables. The real services are bundled and
 * pointed at it, so what is tested is the code that ships.
 *
 * The story it tells is the one that matters: somebody works on a PC, the PC is
 * gone, and the same account on a new PC continues where they left off.
 *
 *   1. an edit is uploaded by itself, with no button pressed
 *   2. a second PC signs in and has the project, its document and its deck
 *   3. signing in twice does not create a second copy
 *   4. offline, the edit waits and is saved when the connection returns
 *
 *   npm run sim:sync
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-sync-sim')
const bundlePath = join(work, 'bundle.js')

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

const PASSWORD = 'CorrectHorse9'
const EMAIL = 'asha@example.test'
const AUTH_UID = '11111111-2222-3333-4444-555555555555'
const PROFILE_ID = 'profile-asha'

const wait = (ms) => new Promise((done) => setTimeout(done, ms))
/** The debounce is 2.5s; give it a moment to finish the request too. */
const settle = () => wait(3200)

/* ------------------------------------------------------------------ */
/* A small, faithful Supabase                                          */
/* ------------------------------------------------------------------ */

const tables = new Map()
const calls = []
const accounts = new Map()
let issued = 0
let online = true

const rows = (name) => {
  if (!tables.has(name)) tables.set(name, new Map())
  return tables.get(name)
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const session = () => {
  issued += 1
  return {
    access_token: `access-${issued}`,
    refresh_token: `refresh-${issued}`,
    expires_in: 3600,
    user: { id: AUTH_UID, email: EMAIL }
  }
}

/** `?id=eq.x&project_id=eq.y` — the subset PostgREST is asked for. */
function filters(query) {
  const out = {}
  for (const [key, value] of new URLSearchParams(query)) {
    if (key === 'select' || key === 'order' || key === 'on_conflict') continue
    if (value.startsWith('eq.')) out[key] = { kind: 'eq', value: value.slice(3) }
    else if (value.startsWith('in.(')) {
      out[key] = { kind: 'in', value: value.slice(4, -1).split(',') }
    }
  }
  return out
}

const matches = (row, applied) =>
  Object.entries(applied).every(([key, rule]) =>
    rule.kind === 'eq' ? String(row[key]) === rule.value : rule.value.includes(String(row[key]))
  )

async function handle(url, init = {}) {
  const method = (init.method ?? 'GET').toUpperCase()
  const body = init.body ? JSON.parse(init.body) : undefined
  calls.push({ url, method, body })

  if (url.includes('/auth/v1/signup')) {
    if (accounts.has(body?.email)) return json({ msg: 'User already registered' }, 422)
    accounts.set(body.email, body.password)
    return json(session())
  }
  if (url.includes('/auth/v1/token?grant_type=password')) {
    if (accounts.get(body?.email) !== body?.password) return json({ error: 'invalid_grant' }, 400)
    return json(session())
  }
  if (url.includes('/auth/v1/token?grant_type=refresh_token')) return json(session())
  if (url.includes('/auth/v1/logout')) return new Response(null, { status: 204 })
  if (url.includes('/rest/v1/rpc/indra_ensure_profile')) {
    return json({
      id: PROFILE_ID,
      username: 'asha',
      display_name: 'Asha Rai',
      member_no: 'IH-2026-000001',
      role: 'member',
      suspended_at: null
    })
  }
  if (url.includes('/rest/v1/indra_users')) return json([{ id: PROFILE_ID }])

  /* The list RPC: everything this account can open, with the owner's name. */
  if (url.includes('/rest/v1/rpc/indra_my_projects')) {
    return json(
      [...rows('indra_projects').values()].map((row) => ({
        ...row,
        owner_name: 'Asha Rai',
        is_owner: true
      }))
    )
  }

  const rest = url.match(/\/rest\/v1\/([a-z_]+)(?:\?([^#]*))?$/)
  if (!rest) return json({ message: `unhandled ${method} ${url}` }, 404)

  const [, table, query = ''] = rest
  const store = rows(table)
  const applied = filters(query)

  if (method === 'GET') {
    return json([...store.values()].filter((row) => matches(row, applied)))
  }
  if (method === 'POST') {
    const incoming = Array.isArray(body) ? body : [body]
    for (const row of incoming) {
      const existing = store.get(row.id)
      store.set(row.id, existing ? { ...existing, ...row } : { ...row })
    }
    return new Response(null, { status: 201 })
  }
  if (method === 'PATCH') {
    for (const [id, row] of store) if (matches(row, applied)) store.set(id, { ...row, ...body })
    return new Response(null, { status: 204 })
  }
  if (method === 'DELETE') {
    for (const [id, row] of [...store]) if (matches(row, applied)) store.delete(id)
    return new Response(null, { status: 204 })
  }
  return new Response(null, { status: 405 })
}

/* ------------------------------------------------------------------ */
/* The harness                                                         */
/* ------------------------------------------------------------------ */

async function main() {
  rmSync(work, { recursive: true, force: true })
  mkdirSync(join(work, 'node_modules', 'electron'), { recursive: true })

  writeFileSync(
    join(work, 'node_modules', 'electron', 'package.json'),
    JSON.stringify({ name: 'electron', version: '45.0.0', main: 'index.js' })
  )

  writeFileSync(
    join(work, 'node_modules', 'electron', 'index.js'),
    `const app = {
  isPackaged: true,
  getVersion: () => '3.0.0',
  getPath: () => globalThis.__userData,
  relaunch: () => {},
  exit: () => {}
}
const net = {
  isOnline: () => globalThis.__online !== false,
  fetch: async (url, init) => {
    if (globalThis.__online === false) throw new Error('offline')
    return globalThis.__syncServer.handle(String(url), init)
  }
}
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) =>
    Buffer.from(Buffer.from(value, 'utf8').toString('base64').split('').reverse().join(''), 'utf8'),
  decryptString: (buffer) =>
    Buffer.from(buffer.toString('utf8').split('').reverse().join(''), 'base64').toString('utf8')
}
const dialog = { showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: true }) }
const BrowserWindow = { getAllWindows: () => [], fromWebContents: () => null }
module.exports = { app, net, safeStorage, dialog, BrowserWindow,
  nativeTheme: { shouldUseDarkColors: true, on: () => {} },
  shell: { openExternal: () => {} },
  ipcMain: { handle: () => {} } }
`
  )

  writeFileSync(
    join(work, 'entry.ts'),
    `export * from ${JSON.stringify(join(root, 'src/main/services/account.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/sync.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/auth.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/projects.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/documents.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/presentations.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/db/database.ts'))}
`
  )

  await build({
    entryPoints: [join(work, 'entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'node:sqlite'],
    outfile: bundlePath,
    logLevel: 'warning'
  })

  const require = createRequire(join(work, 'index.js'))
  require('electron')
  globalThis.__online = true
  globalThis.__syncServer = { handle }

  /** A separate installation: its own database and its own session. */
  function boot(name) {
    globalThis.__userData = join(work, name)
    mkdirSync(globalThis.__userData, { recursive: true })
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(work) && !key.includes('node_modules')) delete require.cache[key]
    }
    calls.length = 0
    return require(bundlePath)
  }

  /* ---- PC one: sign in, type something ---------------------------- */
  let api = boot('pc-one')
  const local = api.register({
    username: 'asha',
    displayName: 'Asha Rai',
    email: EMAIL,
    password: PASSWORD
  })
  const project = api.createProject(local, { name: 'The studio', description: 'Autumn work' })
  const doc = api.createDocument(local, project.id, 'Launch brief')

  await api.createAccountFromLocal(PASSWORD)
  check(api.currentAccountState().connected === true, 'the PC is connected to an INDRA account')

  const saved = api.saveDocument(local, project.id, doc.id, {
    baseVersion: doc.version,
    title: 'Launch brief',
    blocks: [
      { id: 'b1', type: 'heading1', html: 'Launch' },
      { id: 'b2', type: 'paragraph', html: 'Ship it' }
    ]
  })
  check(saved.version === 2, 'the document saves locally as usual')

  /* ---- 1. the edit goes up on its own ----------------------------- */
  await settle()

  const cloudProjects = [...rows('indra_projects').values()]
  check(cloudProjects.length === 1, 'the project reached the cloud without a button', String(cloudProjects.length))

  const cloudDocs = [...rows('indra_documents').values()]
  check(cloudDocs.length === 1, 'and so did the document', String(cloudDocs.length))
  check(
    cloudDocs[0]?.content?.blocks?.length === 2,
    'with the blocks that were typed',
    JSON.stringify(cloudDocs[0]?.content ?? null)
  )

  const state = api.syncState()
  check(state.pending === 0, 'nothing is left waiting', String(state.pending))
  check(Boolean(state.lastSyncedAt), 'and the panel has a time to show')

  /* ---- 2. the PC is gone; a new one signs in ---------------------- */
  api = boot('pc-two')
  const fresh = api.listProjects(api.currentUser() ?? { id: '' })
  check(Array.isArray(fresh) ? fresh.length === 0 : true, 'the new PC starts empty')

  const signedIn = await api.signInAccount({ email: EMAIL, password: PASSWORD })
  const projectsHere = api.listProjects(signedIn.user)
  check(projectsHere.length === 1, 'signing in brings the project down', String(projectsHere.length))
  check(projectsHere[0]?.name === 'The studio', 'with its name', projectsHere[0]?.name)

  const documentsHere = api.listDocuments(signedIn.user, projectsHere[0].id)
  check(documentsHere.length === 1, 'the document is there', String(documentsHere.length))
  check(documentsHere[0]?.title === 'Launch brief', 'under the title it was saved with')

  const documentHere = api.getDocument(signedIn.user, projectsHere[0].id, documentsHere[0].id)
  check(
    documentHere.blocks.length === 2 && documentHere.blocks[1]?.html === 'Ship it',
    'and the text is what was typed on the other machine',
    JSON.stringify(documentHere.blocks)
  )

  /* ---- 3. signing in again does not duplicate --------------------- */
  await api.syncNow()
  const afterRepeat = api.listProjects(signedIn.user)
  check(afterRepeat.length === 1, 'a second save does not add a second copy', String(afterRepeat.length))
  check(
    [...rows('indra_projects').values()].length === 1,
    'and the cloud still holds one project',
    String([...rows('indra_projects').values()].length)
  )

  /* ---- 4. offline: it waits, then it goes ------------------------- */
  globalThis.__online = false
  const again = api.getDocument(signedIn.user, afterRepeat[0].id, documentHere.id)
  api.saveDocument(signedIn.user, afterRepeat[0].id, documentHere.id, {
    baseVersion: again.version,
    title: 'Launch brief',
    blocks: [{ id: 'b1', type: 'heading1', html: 'Launch day' }]
  })
  await settle()
  const offlineState = api.syncState()
  check(offlineState.pending >= 1, 'offline, the edit is kept in the queue', String(offlineState.pending))
  const stillOld = [...rows('indra_documents').values()][0]
  check(
    stillOld?.content?.blocks?.length === 2,
    'and the cloud copy has not been touched',
    JSON.stringify(stillOld?.content ?? null)
  )

  globalThis.__online = true
  await api.syncNow()
  const uploaded = [...rows('indra_documents').values()][0]
  check(
    uploaded?.content?.blocks?.length === 1 &&
      uploaded?.content?.blocks?.[0]?.html === 'Launch day',
    'when the connection returns, the edit is saved',
    JSON.stringify(uploaded?.content ?? null)
  )

  console.log('')
  if (failures > 0) {
    console.error(`${failures} check(s) failed — the databases are in ${work}`)
    process.exitCode = 1
  } else {
    console.log('All automatic saving checks passed.')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
