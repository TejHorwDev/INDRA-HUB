/**
 * The cloud copy.
 *
 * The claim this file checks is narrow and specific: a project saved to the
 * cloud is written under this installation's own identity, in rows the
 * database's Row Level Security lets nobody else read — and with no route out,
 * the app neither reaches the cloud nor shows a cloud row.
 *
 * There is no real network here. `net.fetch` is answered by a small PostgREST
 * and GoTrue stand-in that enforces the same rules the SQL in supabase/ does:
 * a caller is identified by its access token, a project belongs to one
 * profile, and every other caller sees nothing. That is enough to prove the
 * client sends the right shape to the right place, that a second installation
 * is a different person as far as the database is concerned, and that nothing
 * leaves the machine while it is offline.
 *
 *   npm run sim:cloud
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-cloud-sim')
const bundlePath = join(work, 'bundle.cjs')

let failures = 0

function check(pass, label, detail) {
  if (pass) console.log(`✓ ${label}`)
  else {
    failures += 1
    console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

async function refused(run) {
  try {
    await run()
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/* ------------------------------------------------------------------ *
 * A stand-in for PostgREST + GoTrue, with the policies from auth.sql.
 * ------------------------------------------------------------------ */

function createCloud() {
  let userSeq = 0
  let profileSeq = 0
  let tokenSeq = 0

  const users = new Map() // uid -> { email, password }
  const tokens = new Map() // token -> uid
  const profiles = new Map() // uid -> profile id
  const projects = new Map() // id -> row
  const documents = new Map()
  const presentations = new Map()
  const slides = new Map()

  function json(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (body === undefined ? '' : JSON.stringify(body))
    }
  }

  function session(uid) {
    const token = `access-${++tokenSeq}`
    tokens.set(token, uid)
    return {
      access_token: token,
      refresh_token: `refresh-${tokenSeq}`,
      expires_in: 3600,
      user: { id: uid, email: users.get(uid)?.email }
    }
  }

  function caller(headers) {
    const raw = headers?.Authorization ?? ''
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : ''
    return tokens.get(token) ?? null
  }

  function profileOf(uid) {
    if (!uid) return null
    if (!profiles.has(uid)) profiles.set(uid, `profile-${++profileSeq}`)
    return profiles.get(uid)
  }

  /** `indra_in_project` / `indra_owns_project`, for this caller. */
  function inProject(profile, projectId) {
    const project = projects.get(projectId)
    if (!project || !profile) return false
    return project.owner_id === profile || project.members?.includes(profile)
  }

  function ownsProject(profile, projectId) {
    const project = projects.get(projectId)
    return Boolean(project && profile && project.owner_id === profile)
  }

  function upsert(map, row, mode) {
    if (map.has(row.id) && mode === 'ignore') return
    map.set(row.id, row)
  }

  async function handle(rawUrl, init = {}) {
    const url = new URL(rawUrl)
    const path = url.pathname
    const query = url.searchParams
    const method = (init.method ?? 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : undefined
    const profile = profileOf(caller(init.headers))

    /* --- auth --- */
    if (path === '/auth/v1/signup') {
      if (!body?.email || !body?.password) return json(400, { error: 'missing credentials' })
      if ([...users.values()].some((user) => user.email === body.email)) {
        return json(400, { error: 'user already registered' })
      }
      const uid = `auth-${++userSeq}`
      users.set(uid, { email: body.email, password: body.password })
      profileOf(uid)
      return json(200, session(uid))
    }

    if (path === '/auth/v1/token') {
      const grant = query.get('grant_type')
      if (grant === 'password') {
        const entry = [...users.entries()].find(([, user]) => user.email === body?.email)
        if (!entry || entry[1].password !== body?.password) {
          return json(400, { error: 'invalid_grant' })
        }
        return json(200, session(entry[0]))
      }
      if (grant === 'refresh_token') {
        return json(400, { error: 'refresh_token_not_found' })
      }
      return json(400, { error: 'unsupported_grant' })
    }

    /* --- every table below is sealed without a session --- */
    if (!profile) return json(401, { message: 'no session' })

    if (path === '/rest/v1/rpc/indra_my_projects') {
      // The list a member needs: everything this account can open, named.
      const rows = [...projects.values()]
        .filter((row) => inProject(profile, row.id))
        .map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          owner_id: row.owner_id,
          owner_name: 'Owner',
          is_owner: row.owner_id === profile,
          updated_at: row.updated_at
        }))
      return json(200, rows)
    }

    if (path === '/rest/v1/rpc/indra_project_people') {
      const id = body?.p_project ?? ''
      if (!inProject(profile, id)) return json(200, [])
      const project = projects.get(id)
      const rows = [{ id: project.owner_id, display_name: 'Owner', is_owner: true }]
      for (const member of project.members ?? []) {
        rows.push({ id: member, display_name: 'Member', is_owner: false })
      }
      return json(200, rows)
    }

    if (path === '/rest/v1/rpc/indra_my_invites') return json(200, [])

    if (path === '/rest/v1/indra_users') {
      const uid = caller(init.headers)
      const rows = [...profiles.entries()]
        .filter(([authId]) => authId === uid)
        .map(([, id]) => ({ id }))
      return json(200, rows)
    }

    if (path === '/rest/v1/indra_projects') {
      if (method === 'POST') {
        for (const row of body ?? []) {
          if (row.owner_id !== profile) return json(403, { message: 'row violates RLS' })
          upsert(projects, { ...row, members: [] }, 'ignore')
        }
        return json(201)
      }
      if (method === 'PATCH') {
        const id = (query.get('id') ?? '').replace(/^eq\./, '')
        if (!ownsProject(profile, id)) return json(200, [])
        const project = projects.get(id)
        Object.assign(project, {
          name: body?.name ?? project.name,
          description: body?.description ?? project.description,
          updated_at: body?.updated_at ?? project.updated_at
        })
        return json(204)
      }
      if (method === 'DELETE') {
        const id = (query.get('id') ?? '').replace(/^eq\./, '')
        if (ownsProject(profile, id)) projects.delete(id)
        return json(204)
      }
      const ownerFilter = (query.get('owner_id') ?? '').replace(/^eq\./, '')
      const rows = [...projects.values()]
        .filter((row) => row.owner_id === profile && (!ownerFilter || row.owner_id === ownerFilter))
        .filter((row) => inProject(profile, row.id))
        .map(({ id, name, description, updated_at }) => ({ id, name, description, updated_at }))
      const idFilter = (query.get('id') ?? '').replace(/^eq\./, '')
      return json(200, idFilter ? rows.filter((row) => row.id === idFilter) : rows)
    }

    if (path === '/rest/v1/indra_documents') {
      if (method === 'POST') {
        for (const row of body ?? []) {
          if (!inProject(profile, row.project_id)) return json(403, { message: 'row violates RLS' })
          if (documents.has(row.id)) return json(409, { message: 'duplicate key' })
          documents.set(row.id, row)
        }
        return json(201)
      }
      if (method === 'DELETE') {
        const projectId = (query.get('project_id') ?? '').replace(/^eq\./, '')
        if (!ownsProject(profile, projectId)) return json(200, [])
        for (const [id, row] of documents) if (row.project_id === projectId) documents.delete(id)
        return json(204)
      }
      const projectId = (query.get('project_id') ?? '').replace(/^eq\./, '')
      return json(
        200,
        [...documents.values()]
          .filter((row) => row.project_id === projectId && inProject(profile, row.project_id))
          .map(({ id, title, content, created_at, updated_at }) => ({
            id,
            title,
            content,
            created_at,
            updated_at
          }))
      )
    }

    if (path === '/rest/v1/indra_presentations') {
      if (method === 'POST') {
        for (const row of body ?? []) {
          if (!inProject(profile, row.project_id)) return json(403, { message: 'row violates RLS' })
          presentations.set(row.id, row)
        }
        return json(201)
      }
      if (method === 'DELETE') {
        const projectId = (query.get('project_id') ?? '').replace(/^eq\./, '')
        if (!ownsProject(profile, projectId)) return json(200, [])
        for (const [id, row] of presentations) {
          if (row.project_id !== projectId) continue
          presentations.delete(id)
          for (const [slideId, slide] of slides) if (slide.presentation_id === id) slides.delete(slideId)
        }
        return json(204)
      }
      const projectId = (query.get('project_id') ?? '').replace(/^eq\./, '')
      return json(
        200,
        [...presentations.values()]
          .filter((row) => row.project_id === projectId && inProject(profile, row.project_id))
          .map(({ id, title, theme, created_at, updated_at }) => ({
            id,
            title,
            theme,
            created_at,
            updated_at
          }))
      )
    }

    if (path === '/rest/v1/indra_presentation_slides') {
      if (method === 'POST') {
        for (const row of body ?? []) {
          const deck = presentations.get(row.presentation_id)
          if (!deck || !inProject(profile, deck.project_id)) {
            return json(403, { message: 'row violates RLS' })
          }
          slides.set(row.id, row)
        }
        return json(201)
      }
      const filter = query.get('presentation_id') ?? ''
      const wanted = filter
        .replace(/^in\.\(/, '')
        .replace(/\)$/, '')
        .split(',')
        .map((value) => value.trim().replace(/^"|"$/g, ''))
        .filter(Boolean)
      return json(
        200,
        [...slides.values()]
          .filter((row) => wanted.includes(row.presentation_id))
          .filter((row) => {
            const deck = presentations.get(row.presentation_id)
            return deck && inProject(profile, deck.project_id)
          })
          .map(({ id, presentation_id, position, layout, content, notes }) => ({
            id,
            presentation_id,
            position,
            layout,
            content,
            notes
          }))
      )
    }

    return json(404, { message: `no route ${method} ${path}` })
  }

  return { handle, projects, documents, presentations, slides, users, profiles, tokens }
}

/* ------------------------------------------------------------------ *
 * The harness
 * ------------------------------------------------------------------ */

async function main() {
  rmSync(work, { recursive: true, force: true })
  mkdirSync(join(work, 'node_modules', 'electron'), { recursive: true })

  writeFileSync(
    join(work, 'node_modules', 'electron', 'package.json'),
    JSON.stringify({ name: 'electron', version: '45.0.0', main: 'index.js' })
  )

  /*
   * safeStorage is stubbed as working, because the point of the check below is
   * that the identity is sealed when the platform can seal it — not that the
   * fallback exists.
   */
  writeFileSync(
    join(work, 'node_modules', 'electron', 'index.js'),
    `const calls = []
globalThis.__cloudCalls = calls
const app = {
  isPackaged: true,
  getVersion: () => '1.8.0',
  getPath: () => globalThis.__userData,
  relaunch: () => {},
  exit: () => {}
}
const net = {
  isOnline: () => globalThis.__online !== false,
  fetch: async (url, init = {}) => {
    calls.push({ url: String(url), method: (init.method || 'GET').toUpperCase(), body: init.body ? JSON.parse(init.body) : undefined })
    return globalThis.__cloudServer.handle(String(url), init)
  }
}
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) =>
    Buffer.from(Buffer.from(value, 'utf8').toString('base64').split('').reverse().join(''), 'utf8'),
  decryptString: (buffer) =>
    Buffer.from(buffer.toString('utf8').split('').reverse().join(''), 'base64').toString('utf8')
}
const dialog = { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }) }
const BrowserWindow = { getAllWindows: () => [], fromWebContents: () => null }
module.exports = { app, net, safeStorage, dialog, BrowserWindow, nativeTheme: { shouldUseDarkColors: true, on: () => {} }, shell: { openExternal: () => {} }, ipcMain: { handle: () => {} } }
`
  )

  writeFileSync(
    join(work, 'entry.ts'),
    `export * from ${JSON.stringify(join(root, 'src/main/services/cloud.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/auth.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/projects.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/documents.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/presentations.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/connectivity.ts'))}
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
  // Load the stub once: it owns the array every request is recorded in.
  require('electron')
  const cloud = createCloud()
  globalThis.__cloudServer = cloud
  globalThis.__online = true

  /** A separate installation: fresh module state, its own database file. */
  function boot(name) {
    globalThis.__userData = join(work, name)
    mkdirSync(globalThis.__userData, { recursive: true })
    for (const key of Object.keys(require.cache)) {
      // The electron stub stays: it holds the request log and the keystore.
      if (key.startsWith(work) && !key.includes('node_modules')) delete require.cache[key]
    }
    globalThis.__cloudCalls.length = 0
    return require(bundlePath)
  }

  /* ---- this machine, with a local account and some work ------------ */
  let api = boot('pc-one')
  const owner = api.register({
    username: 'asha',
    displayName: 'Asha Rai',
    email: 'asha@example.test',
    password: 'CorrectHorse9'
  })
  const project = api.createProject(owner, { name: 'The studio', description: 'Autumn work' })
  const doc = api.createDocument(owner, project.id, 'Launch brief')
  api.saveDocument(owner, project.id, doc.id, {
    baseVersion: doc.version,
    title: 'Launch brief',
    blocks: [
      { id: 'b1', type: 'heading1', html: 'Launch' },
      { id: 'b2', type: 'paragraph', html: 'Ship it' }
    ]
  })
  const deck = api.createBlankPresentation(owner, project.id, 'Launch deck')
  api.savePresentation(owner, project.id, deck.id, {
    title: 'Launch deck',
    slides: [
      { id: 's1', layout: 'title', title: 'Launch', notes: '' },
      { id: 's2', layout: 'bullets', title: 'Plan', bullets: ['One', 'Two'], notes: 'say it' }
    ]
  })

  /* ---- 1. offline: no cloud at all, and no request either ---------- */
  check(
    (await api.cloudState(owner)).linked === false,
    'a machine that has never saved says it has no cloud identity'
  )

  globalThis.__online = false
  const offlinePush = await refused(() => api.pushProject(owner, project.id))
  check(/offline/i.test(offlinePush), 'offline, saving to the cloud is refused', offlinePush)
  check(globalThis.__cloudCalls.length === 0, 'and not one byte is sent', String(globalThis.__cloudCalls.length))

  const offlineList = await refused(() => api.listCloudProjects(owner))
  check(/offline/i.test(offlineList), 'offline, the cloud list is refused', offlineList)
  check(globalThis.__cloudCalls.length === 0, 'with no request behind it', String(globalThis.__cloudCalls.length))

  const offlineState = await api.cloudState(owner)
  check(offlineState.online === false, 'the state says the cloud is unavailable right now')
  check(/offline/i.test(offlineState.message ?? ''), 'and says why', offlineState.message)

  const localWhileOffline = api.cloudProjectState(owner, project.id)
  check(localWhileOffline.pushedAt === null, 'a project that was never saved has no cloud copy')
  check(
    localWhileOffline.stale === true,
    'and is reported as having work the cloud does not'
  )

  /* ---- 2. online: the first save creates this PC’s own identity ---- */
  globalThis.__online = true
  const pushed = await api.pushProject(owner, project.id)
  check(pushed.documents === 1 && pushed.presentations === 1, 'the project goes up with its document and deck')

  const signup = globalThis.__cloudCalls.find((call) => call.url.includes('/auth/v1/signup'))
  check(Boolean(signup), 'the first save registers an identity for this installation')
  check(
    /^device-[0-9a-f]{16}@/.test(signup?.body?.email ?? ''),
    'with a generated address this PC owns',
    signup?.body?.email
  )
  check(
    typeof signup?.body?.password === 'string' && signup.body.password.length >= 32,
    'and a generated password long enough to matter'
  )

  const projectInsert = globalThis.__cloudCalls.find(
    (call) => call.url.includes('/rest/v1/indra_projects') && call.method === 'POST'
  )
  const row = projectInsert?.body?.[0]
  check(row?.id === project.id, 'the cloud project is keyed on the local project')
  check(/^profile-/.test(row?.owner_id ?? ''), 'owned by this PC’s profile, never a shared one', row?.owner_id)
  check((row?.owner_id ?? '') !== owner.id, 'and not by the local account id, which the cloud never sees')

  const docInsert = globalThis.__cloudCalls.find(
    (call) => call.url.includes('/rest/v1/indra_documents') && call.method === 'POST'
  )
  check(docInsert?.body?.[0]?.content?.blocks?.length === 2, 'the document travels as blocks, not markup')
  check(
    docInsert?.body?.[0]?.id?.startsWith(`${project.id}:d:`),
    'with an id namespaced to the project',
    docInsert?.body?.[0]?.id
  )

  const deckInsert = globalThis.__cloudCalls.find(
    (call) => call.url.includes('/rest/v1/indra_presentations') && call.method === 'POST'
  )
  check(
    ['blank', 'rule', 'ai'].includes(deckInsert?.body?.[0]?.conversion_mode),
    'the deck carries a conversion mode the column will accept',
    deckInsert?.body?.[0]?.conversion_mode
  )

  const slideInsert = globalThis.__cloudCalls.find(
    (call) => call.url.includes('/indra_presentation_slides') && call.method === 'POST'
  )
  check(slideInsert?.body?.length === 2, 'both slides go up', String(slideInsert?.body?.length))
  check(
    slideInsert?.body?.every((slide) => slide.id.includes(':s:')),
    'each named after the deck and the slide, so two decks cannot collide'
  )

  const after = await api.cloudState(owner)
  check(after.linked === true, 'the installation now has a cloud identity')
  check(
    (after.account ?? '').includes('•') && !(after.account ?? '').includes('asha@'),
    'the state shows a masked address, never the whole one',
    after.account
  )

  const stateNow = api.cloudProjectState(owner, project.id)
  check(Boolean(stateNow.pushedAt), 'the project remembers when it was saved')
  check(stateNow.stale === false, 'and is not stale straight afterwards')
  check(
    stateNow.cloudId === project.id && stateNow.documents === 1 && stateNow.presentations === 1,
    'with the counts the cloud holds'
  )

  /* ---- 3. the identity at rest is sealed, not readable ------------- */
  const settings = api
    .getDatabase()
    .prepare("SELECT value FROM app_settings WHERE key LIKE 'cloud_identity:%'")
    .get()
  const stored = settings?.value ?? ''
  check(stored.startsWith('enc:v1:'), 'the identity is sealed by the platform keystore', stored.slice(0, 8))
  check(!stored.includes(signup?.body?.password ?? 'x'), 'the password is not readable in the database')
  check(!stored.includes('@'), 'nor is the address, in plain text')
  const plain = api
    .getDatabase()
    .prepare("SELECT COUNT(*) AS n FROM app_settings WHERE value LIKE '%' || ? || '%'")
    .get(signup?.body?.password ?? 'unlikely')
  check(Number(plain?.n) === 0, 'and nothing else in settings carries it', String(plain?.n))

  /* ---- 4. saving twice replaces the copy instead of stacking it ---- */
  const second = api.getDocument(owner, project.id, doc.id)
  api.saveDocument(owner, project.id, doc.id, {
    baseVersion: second.version,
    title: 'Launch brief',
    blocks: [{ id: 'b1', type: 'heading1', html: 'Launch, revised' }]
  })
  check(api.cloudProjectState(owner, project.id).stale === true, 'new local work marks the copy stale')

  const repush = await api.pushProject(owner, project.id)
  check(repush.documents === 1, 'the second save still has one document')
  check(cloud.documents.size === 1, 'and the cloud holds one row, not two', String(cloud.documents.size))
  check(
    [...cloud.documents.values()][0]?.content?.blocks?.length === 1,
    'the second save replaced the content rather than merging it'
  )
  check(cloud.projects.size === 1, 'and there is still one cloud project', String(cloud.projects.size))

  /* ---- 5. a second installation is a different person ------------- */
  const otherApi = boot('pc-two')
  const otherOwner = otherApi.register({
    username: 'bikash',
    displayName: 'Bikash Shah',
    email: 'bikash@example.test',
    password: 'CorrectHorse9'
  })
  const otherProject = otherApi.createProject(otherOwner, { name: 'Other work' })

  const otherListBefore = await otherApi.listCloudProjects(otherOwner)
  check(otherListBefore.length === 0, 'a new installation sees an empty cloud', String(otherListBefore.length))

  await otherApi.pushProject(otherOwner, otherProject.id)
  const firstList = await api.listCloudProjects(owner)
  const secondList = await otherApi.listCloudProjects(otherOwner)
  check(firstList.length === 1 && firstList[0].name === 'The studio', 'the first installation still sees only its own')
  check(
    secondList.length === 1 && secondList[0].name === 'Other work',
    'the second sees only its own',
    JSON.stringify(secondList.map((entry) => entry.name))
  )
  check(
    !secondList.some((entry) => entry.cloudId === project.id),
    'and never the other project’s id'
  )

  const stolen = await refused(() => otherApi.pullProject(otherOwner, project.id))
  check(/not in this PC/i.test(stolen), 'pulling somebody else’s project is refused', stolen)

  /* ---- 5b. the identity travels to another PC --------------------- */
  const { code } = api.exportCloudKey(owner)
  check(code.startsWith('indrahub-cloud-1.'), 'a transfer code is produced on request')
  check(!code.includes(signup?.body?.email ?? '@'), 'and does not carry the address in clear')

  const badCode = await refused(() => otherApi.adoptCloudKey(otherOwner, 'not-a-code'))
  check(/not a cloud transfer code/i.test(badCode), 'a code that is not ours is refused', badCode)
  const brokenCode = await refused(() => otherApi.adoptCloudKey(otherOwner, 'indrahub-cloud-1.zzzz'))
  check(brokenCode.length > 0, 'and so is one that is damaged', brokenCode)

  const adopted = await otherApi.adoptCloudKey(otherOwner, code)
  check(adopted.linked === true, 'the second PC takes on the first PC’s identity')
  check(
    /•/.test(adopted.account ?? ''),
    'and shows this account’s address, masked',
    adopted.account
  )

  const adoptedList = await otherApi.listCloudProjects(otherOwner)
  check(
    adoptedList.length === 1 && adoptedList[0].name === 'The studio',
    'and can see the first PC’s projects in the cloud',
    JSON.stringify(adoptedList.map((entry) => entry.name))
  )
  check(
    otherApi.cloudProjectState(otherOwner, otherProject.id).pushedAt === null,
    'its old badges are cleared, because they described another account'
  )

  const carried = await otherApi.pullProject(otherOwner, project.id)
  check(carried.name === 'The studio', 'and the project comes down onto the second PC', carried.name)
  check(
    otherApi.getDocument(otherOwner, carried.id, otherApi.listDocuments(otherOwner, carried.id)[0].id)
      .blocks[0]?.html === 'Launch, revised',
    'with the work as it was last saved'
  )
  check(
    (await api.listCloudProjects(owner)).length === 1,
    'while the first PC is untouched by the adoption',
    String((await api.listCloudProjects(owner)).length)
  )

  /* ---- 6. the copy comes back on the same machine ----------------- */
  api = boot('pc-one')
  const reopened = await api.cloudState(owner)
  check(reopened.linked === true, 'the identity survives a restart')
  const restartedProject = api.cloudProjectState(owner, project.id)
  check(Boolean(restartedProject.pushedAt), 'and so does the knowledge of what was saved')

  const beforePull = api.listProjects(owner).length
  const pulled = await api.pullProject(owner, project.id)
  check(pulled.name === 'The studio', 'a cloud copy comes back as a project', pulled.name)
  check(pulled.id !== project.id, 'as a new local project, not the same row')
  check(api.listProjects(owner).length === beforePull + 1, 'and is added to this PC’s projects')

  const pulledDocs = api.listDocuments(owner, pulled.id)
  check(pulledDocs.length === 1 && pulledDocs[0].title === 'Launch brief', 'with its document')
  const pulledDoc = api.getDocument(owner, pulled.id, pulledDocs[0].id)
  check(pulledDoc.blocks[0]?.html === 'Launch, revised', 'and the blocks as they were last saved', pulledDoc.blocks[0]?.html)
  const pulledDecks = api.listPresentations(owner, pulled.id)
  check(pulledDecks.length === 1, 'and its deck')
  const pulledDeck = api.getPresentation(owner, pulled.id, pulledDecks[0].id)
  check(pulledDeck.slides.length === 2, 'with both slides', String(pulledDeck.slides.length))
  check(
    pulledDeck.slides[1]?.bullets?.join(',') === 'One,Two',
    'and their content',
    JSON.stringify(pulledDeck.slides[1]?.bullets)
  )

  const pulledState = api.cloudProjectState(owner, pulled.id)
  check(pulledState.cloudId === project.id, 'the copy remembers where it came from')
  await api.pushProject(owner, pulled.id)
  check(
    cloud.projects.has(project.id) && cloud.projects.size === 2,
    'so saving it pushes over that copy rather than making a second one',
    `${cloud.projects.size} rows`
  )

  /* ---- 7. signing this PC out of the cloud ------------------------ */
  api.forgetCloudIdentity(owner)
  const forgotten = await api.cloudState(owner)
  check(forgotten.linked === false, 'forgetting the identity leaves the machine unlinked')
  check(api.cloudProjectState(owner, pulled.id).pushedAt === null, 'and forgets what was saved where')
  check(
    cloud.projects.size === 2,
    'the copy in the cloud is untouched — it belongs to the account',
    String(cloud.projects.size)
  )

  globalThis.__online = false
  check(
    (await api.cloudState(owner)).linked === false,
    'and an unlinked machine stays unlinked while offline'
  )

  /* ---- 8. the secret key is never in the app ---------------------- */
  const sources = [
    'src/main/services/cloud.ts',
    'src/main/services/backend.ts',
    'src/shared/workspace.ts'
  ].map((file) => readFileSync(join(root, file), 'utf8'))
  // A guard that refuses to run with a secret key is not a secret key: what
  // must never appear is key material, which is a long alphanumeric token.
  const keyMaterial = /(?:sb_secret|service_role)_[A-Za-z0-9_-]{8,}|service_role["'`]\s*:/
  check(
    sources.every((source) => !keyMaterial.test(source)),
    'no source in the cloud path carries a secret key'
  )
  check(
    !keyMaterial.test(readFileSync(bundlePath, 'utf8')),
    'and the bundled main process carries none either'
  )

  console.log('')
  if (failures === 0) console.log('cloud: all checks passed')
  if (failures > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
