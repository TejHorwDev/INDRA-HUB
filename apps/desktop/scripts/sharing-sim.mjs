/**
 * Two PCs, one project.
 *
 * The claim: a person on another machine can be invited by email, accept on
 * their own PC, receive the project with its documents and decks, work on it,
 * send the work back, and be told — not silently merged over — when both
 * machines changed the same item.
 *
 * Two separate installations run in this process, each with its own database
 * file and its own module state; they meet only through the stand-in for
 * PostgREST below, which enforces the rules written in `supabase/`:
 * invitations are addressed to an address, membership is written only by the
 * person answering, and a stranger sees nothing.
 *
 *   npm run sim:sharing
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-sharing-sim')
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
 * A stand-in for PostgREST + GoTrue, with sharing.sql's rules.
 * ------------------------------------------------------------------ */

function createCloud() {
  let userSeq = 0
  let profileSeq = 0
  let tokenSeq = 0

  const users = new Map() // uid -> { email, password }
  const tokens = new Map() // token -> uid
  const profiles = new Map() // uid -> profile row
  const projects = new Map()
  const documents = new Map()
  const presentations = new Map()
  const slides = new Map()
  const members = new Set() // `${projectId}:${profile}`
  const invites = new Map()

  const json = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body))
  })

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
    return tokens.get(raw.startsWith('Bearer ') ? raw.slice(7) : '') ?? null
  }

  function profileOf(uid) {
    if (!uid) return null
    if (!profiles.has(uid)) {
      profiles.set(uid, {
        id: `profile-${++profileSeq}`,
        auth_user_id: uid,
        member_no: `IND-${100 + profileSeq}`,
        username: `member${profileSeq}`,
        display_name: 'Member',
        email: users.get(uid)?.email ?? '',
        contact_email: null
      })
    }
    return profiles.get(uid)
  }

  function inProject(profile, projectId) {
    const project = projects.get(projectId)
    if (!project || !profile) return false
    return project.owner_id === profile.id || members.has(`${projectId}:${profile.id}`)
  }

  function ownsProject(profile, projectId) {
    const project = projects.get(projectId)
    return Boolean(project && profile && project.owner_id === profile.id)
  }

  function peopleOf(projectId) {
    const project = projects.get(projectId)
    if (!project) return []
    const owner = [...profiles.values()].find((row) => row.id === project.owner_id)
    const list = owner ? [{ ...owner, is_owner: true, joined_at: project.created_at }] : []
    for (const profile of profiles.values()) {
      if (!members.has(`${projectId}:${profile.id}`)) continue
      list.push({ ...profile, is_owner: false, joined_at: project.created_at })
    }
    return list
  }

  async function handle(rawUrl, init = {}) {
    const url = new URL(rawUrl)
    const path = url.pathname
    const query = url.searchParams
    const method = (init.method ?? 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : undefined
    const uid = caller(init.headers)
    const profile = uid ? profileOf(uid) : null

    /* --- auth --- */
    if (path === '/auth/v1/signup') {
      if (!body?.email) return json(400, { error: 'missing credentials' })
      if ([...users.values()].some((user) => user.email === body.email)) {
        return json(400, { error: 'user already registered' })
      }
      const id = `auth-${++userSeq}`
      users.set(id, { email: body.email, password: body.password })
      profileOf(id)
      return json(200, session(id))
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
      return json(400, { error: 'refresh_token_not_found' })
    }

    if (!profile) return json(401, { message: 'no session' })

    /* --- profiles: only the address and the name are writable --- */
    if (path === '/rest/v1/indra_users') {
      if (method === 'PATCH') {
        const id = (query.get('id') ?? '').replace(/^eq\./, '')
        const target = [...profiles.values()].find((row) => row.id === id)
        if (!target || target.id !== profile.id) return json(403, { message: 'row violates RLS' })
        for (const key of Object.keys(body ?? {})) {
          if (!['contact_email', 'display_name'].includes(key)) {
            return json(403, { message: `permission denied for column ${key}` })
          }
        }
        Object.assign(target, body)
        return json(204)
      }
      const rows = [...profiles.values()]
        .filter((row) => row.auth_user_id === uid)
        .map((row) => ({ id: row.id }))
      return json(200, rows)
    }

    /* --- the acts that make sharing possible --- */
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.slice('/rest/v1/rpc/'.length)

      if (name === 'indra_my_projects') {
        const rows = [...projects.values()]
          .filter((row) => inProject(profile, row.id))
          .map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            owner_id: row.owner_id,
            owner_name:
              [...profiles.values()].find((entry) => entry.id === row.owner_id)?.display_name ??
              'Unknown',
            is_owner: row.owner_id === profile.id,
            updated_at: row.updated_at
          }))
        return json(200, rows)
      }

      if (name === 'indra_invite_to_project') {
        if (!ownsProject(profile, body?.p_project)) {
          return json(400, { message: 'Only the head developer can invite people to this project.' })
        }
        const email = String(body?.p_email ?? '').trim().toLowerCase()
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          return json(400, { message: 'That is not an email address.' })
        }
        const existing = [...invites.values()].find(
          (row) =>
            row.project_id === body.p_project && row.email === email && row.status === 'pending'
        )
        if (existing) return json(200, existing.id)
        const id = `invite-${invites.size + 1}`
        invites.set(id, {
          id,
          project_id: body.p_project,
          email,
          invited_by: profile.id,
          status: 'pending',
          created_at: new Date(Date.now() + invites.size * 1000).toISOString(),
          responded_at: null
        })
        return json(200, id)
      }

      if (name === 'indra_my_invites') {
        const address = String(profile.contact_email ?? '').toLowerCase()
        const rows = [...invites.values()]
          .filter((row) => row.status === 'pending' && address && row.email === address)
          .map((row) => ({
            id: row.id,
            project_id: row.project_id,
            project_name: projects.get(row.project_id)?.name ?? '',
            invited_by_name:
              [...profiles.values()].find((entry) => entry.id === row.invited_by)?.display_name ??
              'Somebody',
            created_at: row.created_at
          }))
        return json(200, rows)
      }

      if (name === 'indra_answer_invite') {
        const invite = invites.get(body?.p_id)
        if (!invite) return json(400, { message: 'That invitation no longer exists.' })
        if (invite.status !== 'pending') {
          return json(400, { message: 'That invitation has already been answered.' })
        }
        const address = String(profile.contact_email ?? '').toLowerCase()
        if (!address || invite.email !== address) {
          return json(400, { message: 'That invitation is not addressed to this account.' })
        }
        if (body?.p_accept === true) {
          if (!ownsProject(profile, invite.project_id)) {
            members.add(`${invite.project_id}:${profile.id}`)
          }
          invite.status = 'accepted'
          invite.responded_at = new Date().toISOString()
          return json(200, 'accepted')
        }
        invite.status = 'declined'
        return json(200, 'declined')
      }

      if (name === 'indra_cancel_invite') {
        const invite = invites.get(body?.p_id)
        if (!invite || invite.status !== 'pending') return json(200, false)
        if (!ownsProject(profile, invite.project_id)) {
          return json(400, { message: 'Only the head developer can take an invitation back.' })
        }
        invite.status = 'revoked'
        return json(200, true)
      }

      if (name === 'indra_project_people') {
        if (!inProject(profile, body?.p_project)) return json(200, [])
        return json(
          200,
          peopleOf(body.p_project).map((row) => ({
            id: row.id,
            member_no: row.member_no,
            username: row.username,
            display_name: row.display_name,
            is_owner: row.is_owner,
            joined_at: row.joined_at
          }))
        )
      }

      if (name === 'indra_project_invites_for') {
        if (!ownsProject(profile, body?.p_project)) return json(200, [])
        return json(
          200,
          [...invites.values()]
            .filter((row) => row.project_id === body.p_project && row.status === 'pending')
            .map((row) => ({ id: row.id, email: row.email, created_at: row.created_at }))
        )
      }

      return json(404, { message: `no such function ${name}` })
    }

    /* --- tables --- */
    if (path === '/rest/v1/indra_projects') {
      if (method === 'POST') {
        for (const row of body ?? []) {
          if (row.owner_id !== profile.id) return json(403, { message: 'row violates RLS' })
          if (!projects.has(row.id)) projects.set(row.id, { ...row })
        }
        return json(201)
      }
      if (method === 'PATCH') {
        const id = (query.get('id') ?? '').replace(/^eq\./, '')
        if (!ownsProject(profile, id)) return json(200, [])
        Object.assign(projects.get(id), {
          name: body?.name,
          description: body?.description,
          updated_at: body?.updated_at
        })
        return json(204)
      }
      const id = (query.get('id') ?? '').replace(/^eq\./, '')
      const rows = [...projects.values()]
        .filter((row) => inProject(profile, row.id))
        .filter((row) => !id || row.id === id)
        .map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          owner_id: row.owner_id,
          updated_at: row.updated_at
        }))
      return json(200, rows)
    }

    if (path === '/rest/v1/indra_documents') {
      if (method === 'POST') {
        for (const row of body ?? []) {
          if (!inProject(profile, row.project_id)) return json(403, { message: 'row violates RLS' })
          if (documents.has(row.id)) return json(409, { message: 'duplicate key value' })
          documents.set(row.id, { ...row })
        }
        return json(201)
      }
      if (method === 'PATCH') {
        const id = (query.get('id') ?? '').replace(/^eq\./, '')
        const guard = query.get('updated_at')
        const row = documents.get(id)
        if (!row || !inProject(profile, row.project_id)) return json(200, [])
        // The guard is the whole point: a write aimed at a version that has
        // moved on writes nothing at all.
        if (guard && row.updated_at !== guard.replace(/^eq\./, '')) return json(200, [])
        for (const key of Object.keys(body ?? {})) {
          if (!['title', 'content', 'version', 'updated_by', 'updated_at'].includes(key)) {
            return json(403, { message: `permission denied for column ${key}` })
          }
        }
        Object.assign(row, body)
        return json(200, [{ id: row.id, updated_at: row.updated_at }])
      }
      if (method === 'DELETE') {
        const projectId = (query.get('project_id') ?? '').replace(/^eq\./, '')
        if (!ownsProject(profile, projectId)) return json(200, [])
        for (const [id, row] of documents) if (row.project_id === projectId) documents.delete(id)
        return json(204)
      }
      const projectId = (query.get('project_id') ?? '').replace(/^eq\./, '')
      const rows = [...documents.values()]
        .filter((row) => row.project_id === projectId && inProject(profile, row.project_id))
        .map((row) => ({
          id: row.id,
          title: row.title,
          content: row.content,
          version: row.version,
          created_at: row.created_at,
          updated_at: row.updated_at
        }))
      return json(200, rows)
    }

    if (path === '/rest/v1/indra_presentations') {
      if (method === 'POST') {
        for (const row of body ?? []) {
          if (!inProject(profile, row.project_id)) return json(403, { message: 'row violates RLS' })
          presentations.set(row.id, { ...row })
        }
        return json(201)
      }
      if (method === 'PATCH') {
        const id = (query.get('id') ?? '').replace(/^eq\./, '')
        const guard = query.get('updated_at')
        const row = presentations.get(id)
        if (!row || !inProject(profile, row.project_id)) return json(200, [])
        if (guard && row.updated_at !== guard.replace(/^eq\./, '')) return json(200, [])
        Object.assign(row, {
          title: body?.title ?? row.title,
          theme: body?.theme ?? row.theme,
          conversion_mode: body?.conversion_mode ?? row.conversion_mode,
          updated_at: body?.updated_at ?? row.updated_at
        })
        return json(200, [{ id: row.id, updated_at: row.updated_at }])
      }
      if (method === 'DELETE') {
        const projectId = (query.get('project_id') ?? '').replace(/^eq\./, '')
        if (!ownsProject(profile, projectId)) return json(200, [])
        for (const [id, row] of presentations) if (row.project_id === projectId) presentations.delete(id)
        return json(204)
      }
      const projectId = (query.get('project_id') ?? '').replace(/^eq\./, '')
      const rows = [...presentations.values()]
        .filter((row) => row.project_id === projectId && inProject(profile, row.project_id))
        .map((row) => ({
          id: row.id,
          title: row.title,
          theme: row.theme,
          conversion_mode: row.conversion_mode,
          created_at: row.created_at,
          updated_at: row.updated_at
        }))
      return json(200, rows)
    }

    if (path === '/rest/v1/indra_presentation_slides') {
      if (method === 'POST') {
        for (const row of body ?? []) {
          const deck = presentations.get(row.presentation_id)
          if (!deck || !inProject(profile, deck.project_id)) {
            return json(403, { message: 'row violates RLS' })
          }
          slides.set(row.id, { ...row })
        }
        return json(201)
      }
      if (method === 'DELETE') {
        const deckId = (query.get('presentation_id') ?? '').replace(/^eq\./, '')
        const deck = presentations.get(deckId)
        if (deck && inProject(profile, deck.project_id)) {
          for (const [id, row] of slides) if (row.presentation_id === deckId) slides.delete(id)
        }
        return json(204)
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
      )
    }

    return json(404, { message: `no route ${method} ${path}` })
  }

  return { handle, projects, documents, presentations, slides, members, invites, profiles }
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

  writeFileSync(
    join(work, 'node_modules', 'electron', 'index.js'),
    `const calls = []
globalThis.__cloudCalls = calls
const app = {
  isPackaged: true,
  getVersion: () => '1.9.5',
  getPath: () => globalThis.__userData,
  relaunch: () => {},
  exit: () => {}
}
const net = {
  isOnline: () => globalThis.__online !== false,
  fetch: async (url, init = {}) => {
    calls.push({ url: String(url), method: (init.method || 'GET').toUpperCase() })
    if (globalThis.__online === false) throw new Error('net::ERR_INTERNET_DISCONNECTED')
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

  const entry = join(work, 'entry.ts')
  writeFileSync(
    entry,
    `export * from ${JSON.stringify(join(root, 'src/main/services/sharing.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/cloud.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/auth.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/projects.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/documents.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/presentations.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/connectivity.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/db/database.ts'))}
`
  )

  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'node:sqlite'],
    outfile: bundlePath,
    logLevel: 'warning'
  })

  const require = createRequire(join(work, 'index.js'))
  require('electron')
  const cloud = createCloud()
  globalThis.__cloudServer = cloud
  globalThis.__online = true

  /** A separate installation: fresh module state, its own database file. */
  function boot(name) {
    globalThis.__userData = join(work, name)
    mkdirSync(globalThis.__userData, { recursive: true })
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(work) && !key.includes('node_modules')) delete require.cache[key]
    }
    globalThis.__cloudCalls.length = 0
    return require(bundlePath)
  }

  /* ---- PC one: the head developer --------------------------------- */
  const one = boot('pc-one')
  const asha = one.register({
    username: 'asha',
    displayName: 'Asha Rai',
    email: 'asha@example.test',
    password: 'CorrectHorse9'
  })
  const project = one.createProject(asha, { name: 'The studio', description: 'Autumn work' })
  const brief = one.createDocument(asha, project.id, 'Launch brief')
  one.saveDocument(asha, project.id, brief.id, {
    baseVersion: brief.version,
    title: 'Launch brief',
    blocks: [
      { id: 'b1', type: 'heading1', html: 'Launch' },
      { id: 'b2', type: 'paragraph', html: 'Ship it' }
    ]
  })
  const deck = one.createBlankPresentation(asha, project.id, 'Launch deck')
  one.savePresentation(asha, project.id, deck.id, {
    title: 'Launch deck',
    slides: [{ id: 's1', layout: 'title', title: 'Launch', notes: 'say it' }]
  })

  /* ---- 1. inviting somebody who is not on this PC ------------------ */
  const invite = await one.shareByEmail(asha, project.id, 'Bikash@Example.Test')
  check(invite.id.startsWith('invite-'), 'an invitation to another PC is created in the cloud')
  check(invite.pushed === true, 'inviting saves the project to the cloud first')
  const afterInvite = one.cloudProjectState(asha, project.id)
  check(afterInvite.documents === 1 && afterInvite.presentations === 1, 'the cloud copy holds the work')
  check(afterInvite.role === 'owner' && afterInvite.shared === false, 'this PC still sees itself as the owner')
  check(
    [...cloud.profiles.values()].some((row) => row.contact_email === 'asha@example.test'),
    'the profile carries the address this person answers at'
  )

  /* ---- 2. the other PC sees the question, and only its own --------- */
  const two = boot('pc-two')
  const bikash = two.register({
    username: 'bikash',
    displayName: 'Bikash Thapa',
    email: 'bikash@example.test',
    password: 'CorrectHorse9'
  })

  const inbox = await two.sharedInvitations(bikash)
  check(inbox.length === 1, 'the invitation is waiting on the other PC')
  check(inbox[0]?.projectName === 'The studio', 'it names the project')
  check(inbox[0]?.invitedByName === 'Asha Rai', 'and who asked')

  const notices = await two.sharedInvitations(asha)
  check(notices.length === 0, 'the person who asked does not see their own invitation')

  /* ---- 3. accepting brings the project onto this PC ---------------- */
  const accepted = await two.answerSharedInvitation(bikash, inbox[0].id, inbox[0].cloudId, true)
  check(accepted.accepted === true, 'accepting answers the invitation')
  const arrived = accepted.project
  check(Boolean(arrived), 'the project arrives as a real local project')
  check(arrived.owner.displayName === 'Asha Rai', 'it knows whose project it is')
  check(
    arrived.members.length === 1 && arrived.members[0].displayName === 'Bikash Thapa',
    'the account that accepted is the one member',
    JSON.stringify(arrived.members.map((row) => row.displayName))
  )
  check(two.cloudProjectState(bikash, arrived.id).role === 'member', 'this PC knows it is a member')

  const arrivedDocs = two.listDocuments(bikash, arrived.id)
  check(arrivedDocs.length === 1 && arrivedDocs[0].title === 'Launch brief', 'the document came with it')
  check(
    two.listPresentations(bikash, arrived.id).length === 1,
    'and so did the deck'
  )
  const reachedDoc = two.getDocument(bikash, arrived.id, arrivedDocs[0].id)
  check(
    JSON.stringify(reachedDoc.blocks).includes('Ship it'),
    'with its content, not an empty shell'
  )
  check(
    two.getDocument(bikash, arrived.id, arrivedDocs[0].id).id !== brief.id,
    'local ids are this PC’s own'
  )

  /* ---- 4. work done on the other PC travels back ------------------- */
  const memberDoc = two.getDocument(bikash, arrived.id, arrivedDocs[0].id)
  two.saveDocument(bikash, arrived.id, memberDoc.id, {
    baseVersion: memberDoc.version,
    title: 'Launch brief',
    blocks: [
      { id: 'b1', type: 'heading1', html: 'Launch' },
      { id: 'b2', type: 'paragraph', html: 'Ship it on Friday' }
    ]
  })
  const pushed = await two.syncProject(bikash, arrived.id)
  check(pushed.pushed === 1, 'the member’s edit is sent', JSON.stringify(pushed))
  check(pushed.pulled === 0 && pushed.conflicts.length === 0, 'and nothing else moved')

  const seen = await one.syncProject(asha, project.id)
  check(seen.pulled === 1, 'the owner receives it', JSON.stringify(seen))
  check(
    JSON.stringify(one.getDocument(asha, project.id, brief.id).blocks).includes(
      'Ship it on Friday'
    ),
    'the owner’s document shows the member’s sentence'
  )
  const ownerRoster = one.getProject(asha, project.id)
  check(
    ownerRoster.members.some((member) => member.displayName === 'Bikash Thapa'),
    'and the member now appears in the roster by name'
  )

  /* ---- 5. the owner’s work travels the other way ------------------- */
  const ownerDoc = one.getDocument(asha, project.id, brief.id)
  one.saveDocument(asha, project.id, brief.id, {
    baseVersion: ownerDoc.version,
    title: 'Launch brief',
    blocks: [
      { id: 'b1', type: 'heading1', html: 'Launch' },
      { id: 'b2', type: 'paragraph', html: 'Ship it on Friday' },
      { id: 'b3', type: 'paragraph', html: 'Press at nine' }
    ]
  })
  await one.syncProject(asha, project.id)
  const back = await two.syncProject(bikash, arrived.id)
  check(back.pulled === 1, 'the member receives the owner’s change', JSON.stringify(back))
  check(
    JSON.stringify(two.getDocument(bikash, arrived.id, arrivedDocs[0].id).blocks).includes(
      'Press at nine'
    ),
    'and reads it on their own copy'
  )

  /* ---- 6. both change the same item: a question, not a merge ------- */
  const leftDoc = one.getDocument(asha, project.id, brief.id)
  one.saveDocument(asha, project.id, brief.id, {
    baseVersion: leftDoc.version,
    title: 'Launch brief',
    blocks: [{ id: 'b1', type: 'heading1', html: 'Launch, from the studio' }]
  })
  const rightDoc = two.getDocument(bikash, arrived.id, arrivedDocs[0].id)
  two.saveDocument(bikash, arrived.id, rightDoc.id, {
    baseVersion: rightDoc.version,
    title: 'Launch brief',
    blocks: [{ id: 'b1', type: 'heading1', html: 'Launch, from home' }]
  })

  await one.syncProject(asha, project.id)
  const clash = await two.syncProject(bikash, arrived.id)
  check(clash.conflicts.length === 1, 'the same document changed twice is reported', JSON.stringify(clash))
  check(
    JSON.stringify(two.getDocument(bikash, arrived.id, arrivedDocs[0].id).blocks).includes(
      'from home'
    ),
    'the member’s copy is not overwritten'
  )
  check(
    JSON.stringify(one.getDocument(asha, project.id, brief.id).blocks).includes('from the studio'),
    'and neither is the owner’s'
  )
  const openConflicts = two.listConflicts(bikash, arrived.id)
  check(openConflicts.length === 1 && openConflicts[0].title === 'Launch brief', 'the question is kept locally')

  /* ---- 7. answering it: keep mine, then it wins -------------------- */
  await two.resolveConflict(bikash, openConflicts[0].id, 'local')
  check(two.listConflicts(bikash, arrived.id).length === 0, 'answering closes the question')
  const forced = await two.syncProject(bikash, arrived.id)
  check(forced.pushed >= 1, 'the kept copy is sent', JSON.stringify(forced))
  await one.syncProject(asha, project.id)
  check(
    JSON.stringify(one.getDocument(asha, project.id, brief.id).blocks).includes('from home'),
    'and the other PC takes it'
  )

  /* ---- 8. only the head developer invites -------------------------- */
  const notOwner = await refused(() =>
    two.shareByEmail(bikash, arrived.id, 'someone@example.test')
  )
  check(notOwner.includes('head developer'), 'a member cannot invite by email', notOwner)
  const badAddress = await refused(() => one.shareByEmail(asha, project.id, 'not-an-address'))
  check(badAddress.length > 0, 'a malformed address is refused before anything is sent')

  /* ---- 9. no route out: nothing is attempted ----------------------- */
  globalThis.__online = false
  globalThis.__cloudCalls.length = 0
  const offlineSync = await refused(() => two.syncProject(bikash, arrived.id))
  check(offlineSync.includes('offline'), 'a sync while offline is refused', offlineSync)
  check(globalThis.__cloudCalls.length === 0, 'and no request is even attempted')
  const offlineInvites = await refused(() => two.sharedInvitations(bikash))
  check(offlineInvites.includes('offline'), 'the other-PC inbox is refused too')
  globalThis.__online = true

  /* ---- 10. the same project pulled twice is not duplicated --------- */
  const again = await two.syncProject(bikash, arrived.id)
  check(again.pulled === 0, 'a second sync with nothing new does nothing', JSON.stringify(again))
  check(two.listDocuments(bikash, arrived.id).length === 1, 'and does not duplicate the document')

  /* ---- 11. a project pushed before sharing still adopts cleanly -- */
  one.getDatabase().prepare('DELETE FROM cloud_items WHERE project_id = ?').run(project.id)
  const adopted = await one.syncProject(asha, project.id)
  check(
    adopted.conflicts.length === 0,
    'a project with no mapping rows is adopted instead of conflicting',
    JSON.stringify(adopted)
  )
  check(
    one.listDocuments(asha, project.id).length === 1,
    'and nothing is duplicated locally',
    String(one.listDocuments(asha, project.id).length)
  )
  check(
    [...cloud.documents.values()].filter((row) => row.project_id === project.id).length === 1,
    'nor in the cloud',
    String([...cloud.documents.values()].filter((row) => row.project_id === project.id).length)
  )

  console.log('')
  if (failures > 0) {
    console.error(`${failures} check${failures === 1 ? '' : 's'} failed`)
    process.exit(1)
  }
  console.log('All sharing checks passed.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
