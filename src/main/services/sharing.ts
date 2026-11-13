import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type {
  ProjectDetail,
  SessionUser,
  SharedInvitation,
  SharedSyncResult
} from '@shared/types'
import { getDatabase } from '../db/database'
import { errors } from '../lib/errors'
import { cloudRequest, cloudSession, parseCloudJson, pushProject } from './cloud'
import { getProject } from './projects'

/*
 * A project that lives on more than one PC.
 *
 * The cloud copy was built as a backup of one installation. This file is the
 * second job: two people, two machines, one project.
 *
 * The shape of the bargain
 * ------------------------
 * The owner's copy is pushed as before. A person on another PC is *invited by
 * email* through the cloud, accepts there, and the project is brought down as a
 * real local project — documents, decks, slides, the lot. From then on the two
 * copies are kept in step by an explicit **Sync**, never silently: every item
 * remembers the version it last agreed on, and an item changed on both sides is
 * a conflict that is reported rather than merged. Nothing here destroys a local
 * edit without being told to.
 *
 * Why a hash and not a clock
 * --------------------------
 * Two PCs do not share a clock. "Changed since" is answered by comparing a
 * SHA-256 of the item with the hash stored at the last agreement, so a machine
 * whose clock is ten minutes fast cannot make every item look new.
 *
 * What is deliberately not here
 * -----------------------------
 * Deleting a shared document removes it on this PC only. Propagating a delete
 * would mean deleting somebody's work because a row vanished from a table, and
 * that is a decision the product has not made yet.
 */

/* ---------------- local bookkeeping ---------------- */

interface SaveRow {
  cloud_project_id: string
  pushed_at: string
  role: 'owner' | 'member'
  owner_profile: string | null
  owner_name: string | null
  last_sync_at: string | null
}

function saved(projectId: string): SaveRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT cloud_project_id, pushed_at, role, owner_profile, owner_name, last_sync_at
         FROM cloud_saves WHERE project_id = ?`
    )
    .get(projectId) as SaveRow | undefined
}

function cloudIdFor(projectId: string): string {
  const row = saved(projectId)
  if (!row) {
    throw errors.cloud('This project is not in the cloud yet. Save it to the cloud first.')
  }
  return row.cloud_project_id
}

export function markShared(
  projectId: string,
  cloudId: string,
  input: { role: 'owner' | 'member'; ownerProfile: string | null; ownerName: string | null }
): void {
  const now = new Date().toISOString()
  getDatabase()
    .prepare(
      `INSERT INTO cloud_saves
         (project_id, cloud_project_id, pushed_at, document_count, presentation_count,
          role, owner_profile, owner_name, last_sync_at)
       VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         cloud_project_id = excluded.cloud_project_id,
         role             = excluded.role,
         owner_profile    = excluded.owner_profile,
         owner_name       = excluded.owner_name`
    )
    .run(projectId, cloudId, now, input.role, input.ownerProfile, input.ownerName, now)
}

/* ---------------- small helpers ---------------- */

function iso(value: string | null | undefined): string {
  if (!value) return new Date(0).toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function clean(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

interface CloudPerson {
  id: string
  member_no?: string
  username: string
  display_name: string
  is_owner: boolean
  joined_at?: string
}

interface CloudDocumentRow {
  id: string
  title: string
  content: { blocks?: unknown } | null
  version: number
  created_at: string
  updated_at: string
}

interface CloudPresentationRow {
  id: string
  title: string
  theme: string
  conversion_mode: string
  created_at: string
  updated_at: string
}

interface CloudSlideRow {
  id: string
  presentation_id: string
  position: number
  layout: string
  content: Record<string, unknown> | null
  notes: string | null
}

/**
 * The local stand-in for somebody who is on this project but not on this PC.
 *
 * They are a real row in `users`, so every screen that names a member keeps
 * working, but `remote_profile` marks them as a copy: they cannot sign in, and
 * member search never offers them.
 */
function shadowFor(person: CloudPerson): string {
  const db = getDatabase()
  const existing = db
    .prepare('SELECT id FROM users WHERE remote_profile = ?')
    .get(person.id) as { id: string } | undefined

  if (existing) {
    const name = clean(person.display_name, 'Teammate')
    db.prepare('UPDATE users SET display_name = ? WHERE id = ? AND display_name <> ?').run(
      name,
      existing.id,
      name
    )
    return existing.id
  }

  const id = randomUUID()
  const suffix = person.id.replace(/[^a-z0-9]/gi, '').slice(0, 12) || randomBytes(4).toString('hex')
  db.prepare(
    `INSERT INTO users
       (id, username, display_name, email, password_hash, password_salt, created_at, remote_profile)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    `remote_${suffix}`,
    clean(person.display_name, 'Teammate'),
    `remote+${suffix}@shared.indra.hub`,
    randomBytes(32).toString('hex'),
    randomBytes(16).toString('hex'),
    new Date().toISOString(),
    person.id
  )
  return id
}

/* ---------------- invitations ---------------- */

/**
 * Ask an address, from the project's own screen.
 *
 * The project has to exist in the cloud before it can be shared from there, so
 * the first call saves it — the button the person pressed is "invite", not
 * "save and invite".
 */
export async function shareByEmail(
  viewer: SessionUser,
  projectId: string,
  address: string
): Promise<{ id: string; pushed: boolean }> {
  const email = String(address ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw errors.validation('That is not an email address.', 'email')
  }

  const project = getProject(viewer, projectId)
  if (project.owner.id !== viewer.id) {
    throw errors.forbidden('Only the head developer can invite people to this project.')
  }
  if (email === viewer.email.trim().toLowerCase()) {
    throw errors.validation('That is this account’s own address.', 'email')
  }

  let pushed = false
  if (!saved(projectId)) {
    await pushProject(viewer, projectId)
    pushed = true
  }

  const session = await cloudSession(viewer)
  const cloudId = cloudIdFor(projectId)
  const id = await cloudRequest<string>('/rest/v1/rpc/indra_invite_to_project', {
    method: 'POST',
    token: session.token,
    body: { p_project: cloudId, p_email: email }
  })

  // The owner now knows this project is shared, even before anybody accepts.
  const row = saved(projectId)
  if (row && row.role !== 'owner') markShared(projectId, cloudId, { role: 'owner', ownerProfile: session.profile, ownerName: viewer.displayName })

  return { id: String(id ?? ''), pushed }
}

/** What is waiting for this account, on any PC. */
export async function sharedInvitations(viewer: SessionUser): Promise<SharedInvitation[]> {
  const session = await cloudSession(viewer)
  const rows = await cloudRequest<Array<{ id: string; project_id: string; project_name: string; invited_by_name: string; created_at: string }>>(
    '/rest/v1/rpc/indra_my_invites',
    { method: 'POST', token: session.token, body: {} }
  )

  return (rows ?? []).map((row) => ({
    id: row.id,
    cloudId: row.project_id,
    projectName: row.project_name,
    invitedByName: row.invited_by_name,
    createdAt: iso(row.created_at)
  }))
}

/**
 * Answer one. Accepting brings the project down as a working copy; declining
 * writes nothing but the answer.
 */
export async function answerSharedInvitation(
  viewer: SessionUser,
  invitationId: string,
  cloudId: string,
  accept: boolean
): Promise<{ accepted: boolean; project: ProjectDetail | null }> {
  const session = await cloudSession(viewer)
  const answer = await cloudRequest<string>('/rest/v1/rpc/indra_answer_invite', {
    method: 'POST',
    token: session.token,
    body: { p_id: invitationId, p_accept: accept }
  })

  if (!accept || answer !== 'accepted') return { accepted: false, project: null }
  // The invitation is closed, and the membership the database just wrote is
  // what lets this pull through. The id comes from the list the person
  // clicked, never from this call.
  const project = await pullSharedProject(viewer, cloudId, {
    token: session.token,
    profile: session.profile
  })
  return { accepted: true, project }
}

/** Questions this owner is still waiting on, for the project's screen. */
export async function pendingShares(
  viewer: SessionUser,
  projectId: string
): Promise<Array<{ id: string; email: string; createdAt: string }>> {
  if (!saved(projectId)) return []
  const session = await cloudSession(viewer)
  const rows = await cloudRequest<Array<{ id: string; email: string; created_at: string }>>(
    '/rest/v1/rpc/indra_project_invites_for',
    { method: 'POST', token: session.token, body: { p_project: cloudIdFor(projectId) } }
  )
  return (rows ?? []).map((row) => ({ id: row.id, email: row.email, createdAt: iso(row.created_at) }))
}

export async function cancelShare(viewer: SessionUser, invitationId: string): Promise<null> {
  const session = await cloudSession(viewer)
  await cloudRequest<boolean>('/rest/v1/rpc/indra_cancel_invite', {
    method: 'POST',
    token: session.token,
    body: { p_id: invitationId }
  })
  return null
}

/* ---------------- bringing a shared project down ---------------- */

interface CloudProjectRow {
  id: string
  name: string
  description: string
  owner_id: string
  updated_at: string
}

async function fetchPeople(token: string, cloudId: string): Promise<CloudPerson[]> {
  const rows = await cloudRequest<CloudPerson[]>('/rest/v1/rpc/indra_project_people', {
    method: 'POST',
    token,
    body: { p_project: cloudId }
  })
  return rows ?? []
}

function ownerOf(people: CloudPerson[], cloudProject: CloudProjectRow): CloudPerson {
  return (
    people.find((person) => person.is_owner) ?? {
      id: cloudProject.owner_id,
      username: 'owner',
      display_name: 'The head developer',
      is_owner: true
    }
  )
}

/**
 * Makes the project exist on this PC.
 *
 * Ids are new here — the owner's ids mean nothing on this machine — and the
 * translation is written down in `cloud_items`, which is what a later sync
 * reads. The same archive rules do not apply because this is not an import:
 * this *is* the shared project, and it is written as one.
 */
export async function pullSharedProject(
  viewer: SessionUser,
  cloudId: string,
  sessionOverride?: { token: string; profile: string }
): Promise<ProjectDetail> {
  const existing = getDatabase()
    .prepare('SELECT project_id FROM cloud_saves WHERE cloud_project_id = ?')
    .get(cloudId) as { project_id: string } | undefined
  if (existing) {
    await syncProject(viewer, existing.project_id)
    return getProject(viewer, existing.project_id)
  }

  const session = sessionOverride ?? (await cloudSession(viewer))
  const token = session.token

  const [project] = await cloudRequest<CloudProjectRow[]>(
    `/rest/v1/indra_projects?select=id,name,description,owner_id,updated_at&id=eq.${encodeURIComponent(cloudId)}`,
    { token }
  )
  if (!project) throw errors.notFound('That project is not available to this account.')

  const [documents, presentations] = await Promise.all([
    cloudRequest<CloudDocumentRow[]>(
      `/rest/v1/indra_documents?select=id,title,content,version,created_at,updated_at&project_id=eq.${encodeURIComponent(cloudId)}&order=created_at`,
      { token }
    ),
    cloudRequest<CloudPresentationRow[]>(
      `/rest/v1/indra_presentations?select=id,title,theme,conversion_mode,created_at,updated_at&project_id=eq.${encodeURIComponent(cloudId)}&order=created_at`,
      { token }
    )
  ])

  const slides =
    presentations && presentations.length > 0
      ? await cloudRequest<CloudSlideRow[]>(
          `/rest/v1/indra_presentation_slides?select=id,presentation_id,position,layout,content,notes&presentation_id=in.(${presentations
            .map((row) => `"${row.id}"`)
            .join(',')})&order=position`,
          { token }
        )
      : []

  const people = await fetchPeople(token, cloudId)
  const owner = ownerOf(people ?? [], project)
  const meIsOwner = owner.id === session.profile

  const db = getDatabase()
  const projectId = randomUUID()
  const now = new Date().toISOString()
  const ownerLocalId = meIsOwner ? viewer.id : shadowFor(owner)

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO projects (id, name, description, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      projectId,
      clean(project.name, 'Shared project'),
      clean(project.description),
      ownerLocalId,
      iso(project.updated_at),
      iso(project.updated_at)
    )

    const addMember = db.prepare(
      `INSERT INTO project_members (project_id, user_id, role, joined_at)
       VALUES (?, ?, 'member', ?) ON CONFLICT DO NOTHING`
    )
    if (!meIsOwner) addMember.run(projectId, viewer.id, now)
    for (const person of people ?? []) {
      if (person.is_owner || person.id === session.profile) continue
      addMember.run(projectId, shadowFor(person), iso(person.joined_at))
    }

    markShared(projectId, cloudId, {
      role: meIsOwner ? 'owner' : 'member',
      ownerProfile: owner.id,
      ownerName: clean(owner.display_name, 'The head developer')
    })

    const mapItem = db.prepare(
      `INSERT INTO cloud_items (project_id, kind, local_id, cloud_id, synced_at, synced_hash, force)
       VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(project_id, kind, local_id) DO UPDATE SET
         cloud_id = excluded.cloud_id, synced_at = excluded.synced_at, synced_hash = excluded.synced_hash`
    )

    const author = (profileId: string | undefined): string => {
      if (!profileId) return ownerLocalId
      if (profileId === session.profile) return viewer.id
      const person = (people ?? []).find((entry) => entry.id === profileId)
      return person ? shadowFor(person) : ownerLocalId
    }

    for (const document of documents ?? []) {
      const id = randomUUID()
      const content = JSON.stringify(document.content ?? { blocks: [] })
      db.prepare(
        `INSERT INTO documents
           (id, project_id, title, content, version, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        projectId,
        clean(document.title, 'Untitled'),
        content,
        Number(document.version) || 1,
        author((document as { created_by?: string }).created_by),
        author((document as { updated_by?: string }).updated_by),
        iso(document.created_at),
        iso(document.updated_at)
      )
      mapItem.run(
        projectId,
        'document',
        id,
        document.id,
        iso(document.updated_at),
        hash({ title: clean(document.title, 'Untitled'), content })
      )
    }

    for (const presentation of presentations ?? []) {
      const id = randomUUID()
      const mine = (slides ?? [])
        .filter((slide) => slide.presentation_id === presentation.id)
        .sort((a, b) => Number(a.position) - Number(b.position))
      db.prepare(
        `INSERT INTO presentations
           (id, project_id, title, theme, conversion_mode, source_document_id,
            source_document_version, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
      ).run(
        id,
        projectId,
        clean(presentation.title, 'Untitled deck'),
        clean(presentation.theme, 'minimal'),
        ['blank', 'rule', 'ai'].includes(presentation.conversion_mode)
          ? presentation.conversion_mode
          : 'blank',
        author((presentation as { created_by?: string }).created_by),
        iso(presentation.created_at),
        iso(presentation.updated_at)
      )
      const insertSlide = db.prepare(
        `INSERT INTO presentation_slides (id, presentation_id, position, layout, content, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      mine.forEach((slide, index) => {
        insertSlide.run(
          randomUUID(),
          id,
          index,
          clean(slide.layout, 'title'),
          JSON.stringify(slide.content ?? {}),
          clean(slide.notes)
        )
      })
      mapItem.run(projectId, 'presentation', id, presentation.id, iso(presentation.updated_at), hashOfPresentation(
        { title: clean(presentation.title, 'Untitled deck'), theme: clean(presentation.theme, 'minimal') },
        mine
      ))
    }

    db.prepare('UPDATE cloud_saves SET document_count = ?, presentation_count = ? WHERE project_id = ?').run(
      (documents ?? []).length,
      (presentations ?? []).length,
      projectId
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return getProject(viewer, projectId)
}

function hashOfPresentation(
  presentation: { title: string; theme: string },
  slides: Array<{ layout: string; content: unknown; notes: string | null }>
): string {
  return hash({
    title: presentation.title,
    theme: presentation.theme,
    slides: slides.map((slide) => ({
      layout: slide.layout,
      content: slide.content,
      notes: slide.notes ?? ''
    }))
  })
}

/* ---------------- keeping two copies in step ---------------- */

interface LocalDocument {
  id: string
  title: string
  content: string
  version: number
  updated_at: string
}

interface LocalPresentation {
  id: string
  title: string
  theme: string
  conversion_mode: string
  updated_at: string
}

interface LocalSlide {
  id: string
  layout: string
  content: string
  notes: string
}

interface MappingRow {
  kind: 'document' | 'presentation'
  local_id: string
  cloud_id: string
  synced_at: string | null
  synced_hash: string | null
  force: number
}

/**
 * Records one question per item, however many passes notice it: the pull and
 * the push phase both see the same disagreement, and a person should be asked
 * once.
 */
function conflict(projectId: string, kind: 'document' | 'presentation', localId: string, title: string): void {
  const db = getDatabase()
  const existing = db
    .prepare('SELECT 1 FROM cloud_conflicts WHERE project_id = ? AND kind = ? AND local_id = ?')
    .get(projectId, kind, localId)
  if (existing) return
  db.prepare(
    `INSERT INTO cloud_conflicts (id, project_id, kind, local_id, title, detected_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), projectId, kind, localId, title, new Date().toISOString())
}

function localSlides(presentationId: string): LocalSlide[] {
  return getDatabase()
    .prepare(
      'SELECT id, layout, content, notes FROM presentation_slides WHERE presentation_id = ? ORDER BY position'
    )
    .all(presentationId) as unknown as LocalSlide[]
}

function presentationHash(row: LocalPresentation): string {
  return hashOfPresentation(
    { title: row.title, theme: row.theme },
    localSlides(row.id).map((slide) => ({
      layout: slide.layout,
      content: parseCloudJson(slide.content, {}),
      notes: slide.notes
    }))
  )
}

/**
 * One pass in both directions.
 *
 * Pull first: a change made elsewhere lands here before this PC's changes go
 * out, so the comparison that decides "conflict" is made against the same
 * version on both sides. Push second: everything that is still different goes
 * up, guarded by the version it replaced.
 */
export async function syncProject(viewer: SessionUser, projectId: string): Promise<SharedSyncResult> {
  const row = saved(projectId)
  if (!row) throw errors.cloud('This project has no cloud copy yet.')
  const project = getProject(viewer, projectId)
  const cloudId = row.cloud_project_id

  const session = await cloudSession(viewer)
  const token = session.token
  const db = getDatabase()

  const [projectRow, documents, presentations] = await Promise.all([
    cloudRequest<CloudProjectRow[]>(
      `/rest/v1/indra_projects?select=id,name,description,owner_id,updated_at&id=eq.${encodeURIComponent(cloudId)}`,
      { token }
    ),
    cloudRequest<CloudDocumentRow[]>(
      `/rest/v1/indra_documents?select=id,title,content,version,created_at,updated_at&project_id=eq.${encodeURIComponent(cloudId)}&order=created_at`,
      { token }
    ),
    cloudRequest<CloudPresentationRow[]>(
      `/rest/v1/indra_presentations?select=id,title,theme,conversion_mode,created_at,updated_at&project_id=eq.${encodeURIComponent(cloudId)}&order=created_at`,
      { token }
    )
  ])

  const remoteProject = projectRow?.[0]
  if (!remoteProject) throw errors.cloud('That project is no longer in the cloud.')

  const cloudDocs = documents ?? []
  const cloudPres = presentations ?? []
  const cloudSlides =
    cloudPres.length > 0
      ? ((await cloudRequest<CloudSlideRow[]>(
          `/rest/v1/indra_presentation_slides?select=id,presentation_id,position,layout,content,notes&presentation_id=in.(${cloudPres
            .map((entry) => `"${entry.id}"`)
            .join(',')})&order=position`,
          { token }
        )) ?? [])
      : []

  const maps = db
    .prepare('SELECT kind, local_id, cloud_id, synced_at, synced_hash, force FROM cloud_items WHERE project_id = ?')
    .all(projectId) as unknown as MappingRow[]
  const byCloud = new Map(maps.map((entry) => [entry.cloud_id, entry]))
  const byLocal = new Map(maps.map((entry) => [`${entry.kind}:${entry.local_id}`, entry]))

  const writeMap = db.prepare(
    `INSERT INTO cloud_items (project_id, kind, local_id, cloud_id, synced_at, synced_hash, force)
     VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(project_id, kind, local_id) DO UPDATE SET
       cloud_id = excluded.cloud_id, synced_at = excluded.synced_at, synced_hash = excluded.synced_hash`
  )

  let pulled = 0
  let pushed = 0
  const conflicts: Array<{ kind: 'document' | 'presentation'; title: string }> = []

  /* --- the roster: who is on this project now --- */
  const people = await fetchPeople(token, cloudId)
  const owner = ownerOf(people ?? [], remoteProject)
  const meIsOwner = owner.id === session.profile
  const ownerLocalId = meIsOwner ? viewer.id : (db.prepare('SELECT id FROM users WHERE remote_profile = ?').get(owner.id) as { id: string } | undefined)?.id

  if (ownerLocalId && ownerLocalId !== project.owner.id) {
    // The project was created here before this person was its owner's shadow;
    // keep the owner row truthful.
    db.prepare('UPDATE projects SET owner_id = ? WHERE id = ? AND owner_id <> ?').run(
      ownerLocalId,
      projectId,
      ownerLocalId
    )
  }

  const addMember = db.prepare(
    `INSERT INTO project_members (project_id, user_id, role, joined_at)
     VALUES (?, ?, 'member', ?) ON CONFLICT DO NOTHING`
  )
  const roster = new Set<string>()
  for (const person of people ?? []) {
    if (person.is_owner) continue
    const localId = person.id === session.profile ? viewer.id : shadowFor(person)
    roster.add(localId)
    if (person.id === session.profile && meIsOwner) continue
    addMember.run(projectId, localId, iso(person.joined_at))
  }
  const keep = [...roster]
  db.prepare(
    `DELETE FROM project_members
      WHERE project_id = ?
        AND user_id IN (SELECT id FROM users WHERE remote_profile IS NOT NULL)
        ${keep.length ? `AND user_id NOT IN (${keep.map(() => '?').join(',')})` : ''}`
  ).run(projectId, ...keep)

  /*
   * A project pushed by a build that predates sharing has no mapping rows.
   * Without them every local item would look new and the whole project would be
   * sent a second time.
   *
   * The join is recovered from the id the old push used — it was built from the
   * local id — and the baseline is chosen from something this machine knows for
   * certain: whether the item has been touched since the last push.
   * Untouched here means the cloud's version is the newer one, so the baseline
   * is set to the local copy and the cloud is allowed to win; touched means
   * this PC's copy is the newer one, and it is allowed to win instead.
   */
  const adopt = db.prepare(
    `INSERT INTO cloud_items (project_id, kind, local_id, cloud_id, synced_at, synced_hash, force)
     VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(project_id, kind, local_id) DO NOTHING`
  )
  const legacyDocs = db
    .prepare('SELECT id, title, content, updated_at FROM documents WHERE project_id = ?')
    .all(projectId) as unknown as LocalDocument[]
  for (const local of legacyDocs) {
    if (byLocal.has(`document:${local.id}`)) continue
    const remote = cloudDocs.find((entry) => entry.id === `${cloudId}:d:${local.id}`)
    if (!remote) continue
    const localHash = hash({ title: local.title, content: local.content })
    const touched = iso(local.updated_at) > iso(row.pushed_at)
    adopt.run(
      projectId,
      'document',
      local.id,
      remote.id,
      touched ? iso(remote.updated_at) : null,
      touched ? hash({ title: clean(remote.title, 'Untitled'), content: JSON.stringify(remote.content ?? { blocks: [] }) }) : localHash
    )
    byCloud.set(remote.id, {
      kind: 'document',
      local_id: local.id,
      cloud_id: remote.id,
      synced_at: touched ? iso(remote.updated_at) : null,
      synced_hash: touched
        ? hash({ title: clean(remote.title, 'Untitled'), content: JSON.stringify(remote.content ?? { blocks: [] }) })
        : localHash,
      force: 0
    })
    byLocal.set(`document:${local.id}`, {
      kind: 'document',
      local_id: local.id,
      cloud_id: remote.id,
      synced_at: touched ? iso(remote.updated_at) : null,
      synced_hash: touched
        ? hash({ title: clean(remote.title, 'Untitled'), content: JSON.stringify(remote.content ?? { blocks: [] }) })
        : localHash,
      force: 0
    })
  }
  const legacyPres = db
    .prepare('SELECT id, title, theme, conversion_mode, updated_at FROM presentations WHERE project_id = ?')
    .all(projectId) as unknown as LocalPresentation[]
  for (const local of legacyPres) {
    if (byLocal.has(`presentation:${local.id}`)) continue
    const remote = cloudPres.find((entry) => entry.id === `${cloudId}:p:${local.id}`)
    if (!remote) continue
    const localHash = presentationHash(local)
    const touched = iso(local.updated_at) > iso(row.pushed_at)
    const remoteHash = presentationHash({
      ...local,
      title: clean(remote.title, 'Untitled deck'),
      theme: clean(remote.theme, 'minimal')
    })
    adopt.run(
      projectId,
      'presentation',
      local.id,
      remote.id,
      touched ? iso(remote.updated_at) : null,
      touched ? remoteHash : localHash
    )
    byCloud.set(remote.id, {
      kind: 'presentation',
      local_id: local.id,
      cloud_id: remote.id,
      synced_at: touched ? iso(remote.updated_at) : null,
      synced_hash: touched ? remoteHash : localHash,
      force: 0
    })
    byLocal.set(`presentation:${local.id}`, {
      kind: 'presentation',
      local_id: local.id,
      cloud_id: remote.id,
      synced_at: touched ? iso(remote.updated_at) : null,
      synced_hash: touched ? remoteHash : localHash,
      force: 0
    })
  }

  /* --- documents, pulled --- */
  for (const document of cloudDocs) {
    const map = byCloud.get(document.id)
    if (!map) {
      const id = randomUUID()
      const content = JSON.stringify(document.content ?? { blocks: [] })
      const authorId = meIsOwner ? viewer.id : (ownerLocalId ?? viewer.id)
      db.prepare(
        `INSERT INTO documents
           (id, project_id, title, content, version, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        projectId,
        clean(document.title, 'Untitled'),
        content,
        Number(document.version) || 1,
        authorId,
        authorId,
        iso(document.created_at),
        iso(document.updated_at)
      )
      writeMap.run(projectId, 'document', id, document.id, iso(document.updated_at), hash({ title: clean(document.title, 'Untitled'), content }))
      pulled += 1
      continue
    }

    const local = db
      .prepare('SELECT id, title, content, version, updated_at FROM documents WHERE id = ?')
      .get(map.local_id) as LocalDocument | undefined
    if (!local) {
      db.prepare('DELETE FROM cloud_items WHERE project_id = ? AND kind = ? AND local_id = ?').run(
        projectId,
        'document',
        map.local_id
      )
      continue
    }

    const localHash = hash({ title: local.title, content: local.content })
    const remoteChanged = iso(document.updated_at) !== iso(map.synced_at)
    const localChanged = localHash !== map.synced_hash

    if (!remoteChanged) continue
    if (localChanged) {
      conflict(projectId, 'document', local.id, local.title)
      conflicts.push({ kind: 'document', title: local.title })
      continue
    }

    const content = JSON.stringify(document.content ?? { blocks: [] })
    db.prepare('UPDATE documents SET title = ?, content = ?, version = ?, updated_at = ? WHERE id = ?').run(
      clean(document.title, 'Untitled'),
      content,
      Number(document.version) || local.version,
      iso(document.updated_at),
      local.id
    )
    writeMap.run(
      projectId,
      'document',
      local.id,
      document.id,
      iso(document.updated_at),
      hash({ title: clean(document.title, 'Untitled'), content })
    )
    pulled += 1
  }

  /* --- decks, pulled --- */
  for (const presentation of cloudPres) {
    const map = byCloud.get(presentation.id)
    if (!map) {
      const id = randomUUID()
      const mine = cloudSlides
        .filter((slide) => slide.presentation_id === presentation.id)
        .sort((a, b) => Number(a.position) - Number(b.position))
      const authorId = meIsOwner ? viewer.id : (ownerLocalId ?? viewer.id)
      db.prepare(
        `INSERT INTO presentations
           (id, project_id, title, theme, conversion_mode, source_document_id,
            source_document_version, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
      ).run(
        id,
        projectId,
        clean(presentation.title, 'Untitled deck'),
        clean(presentation.theme, 'minimal'),
        ['blank', 'rule', 'ai'].includes(presentation.conversion_mode)
          ? presentation.conversion_mode
          : 'blank',
        authorId,
        iso(presentation.created_at),
        iso(presentation.updated_at)
      )
      const insertSlide = db.prepare(
        `INSERT INTO presentation_slides (id, presentation_id, position, layout, content, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      mine.forEach((slide, index) => {
        insertSlide.run(
          randomUUID(),
          id,
          index,
          clean(slide.layout, 'title'),
          JSON.stringify(slide.content ?? {}),
          clean(slide.notes)
        )
      })
      writeMap.run(
        projectId,
        'presentation',
        id,
        presentation.id,
        iso(presentation.updated_at),
        presentationHash({
          id,
          title: clean(presentation.title, 'Untitled deck'),
          theme: clean(presentation.theme, 'minimal'),
          conversion_mode: 'blank',
          updated_at: iso(presentation.updated_at)
        })
      )
      pulled += 1
      continue
    }

    const local = db
      .prepare('SELECT id, title, theme, conversion_mode, updated_at FROM presentations WHERE id = ?')
      .get(map.local_id) as LocalPresentation | undefined
    if (!local) {
      db.prepare('DELETE FROM cloud_items WHERE project_id = ? AND kind = ? AND local_id = ?').run(
        projectId,
        'presentation',
        map.local_id
      )
      continue
    }

    const localHash = presentationHash(local)
    const remoteChanged = iso(presentation.updated_at) !== iso(map.synced_at)
    const localChanged = localHash !== map.synced_hash

    if (!remoteChanged) continue
    if (localChanged) {
      conflict(projectId, 'presentation', local.id, local.title)
      conflicts.push({ kind: 'presentation', title: local.title })
      continue
    }

    db.prepare('UPDATE presentations SET title = ?, theme = ?, updated_at = ? WHERE id = ?').run(
      clean(presentation.title, 'Untitled deck'),
      clean(presentation.theme, 'minimal'),
      iso(presentation.updated_at),
      local.id
    )
    db.prepare('DELETE FROM presentation_slides WHERE presentation_id = ?').run(local.id)
    const insertSlide = db.prepare(
      `INSERT INTO presentation_slides (id, presentation_id, position, layout, content, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    cloudSlides
      .filter((slide) => slide.presentation_id === presentation.id)
      .sort((a, b) => Number(a.position) - Number(b.position))
      .forEach((slide, index) => {
        insertSlide.run(
          randomUUID(),
          local.id,
          index,
          clean(slide.layout, 'title'),
          JSON.stringify(slide.content ?? {}),
          clean(slide.notes)
        )
      })
    writeMap.run(
      projectId,
      'presentation',
      local.id,
      presentation.id,
      iso(presentation.updated_at),
      presentationHash({ ...local, title: clean(presentation.title, 'Untitled deck'), theme: clean(presentation.theme, 'minimal') })
    )
    pulled += 1
  }

  /* --- documents, pushed --- */
  const localDocs = db
    .prepare('SELECT id, title, content, version, updated_at FROM documents WHERE project_id = ?')
    .all(projectId) as unknown as LocalDocument[]
  const cloudDocsById = new Map(cloudDocs.map((entry) => [entry.id, entry]))

  for (const local of localDocs) {
    const map = byLocal.get(`document:${local.id}`)
    const localHash = hash({ title: local.title, content: local.content })

    if (!map) {
      const cloudDocumentId = `${cloudId}:d:${randomUUID()}`
      const payload = {
        id: cloudDocumentId,
        project_id: cloudId,
        title: local.title,
        content: parseCloudJson(local.content, { blocks: [] }),
        version: local.version,
        created_by: session.profile,
        updated_by: session.profile,
        created_at: iso(local.updated_at),
        updated_at: new Date().toISOString()
      }
      await cloudRequest('/rest/v1/indra_documents', {
        method: 'POST',
        token,
        prefer: 'return=minimal',
        body: [payload]
      })
      writeMap.run(projectId, 'document', local.id, cloudDocumentId, payload.updated_at, localHash)
      pushed += 1
      continue
    }

    if (localHash === map.synced_hash) continue
    const remote = cloudDocsById.get(map.cloud_id)
    const remoteChanged = remote ? iso(remote.updated_at) !== iso(map.synced_at) : false
    if (remoteChanged && !map.force) {
      conflict(projectId, 'document', local.id, local.title)
      conflicts.push({ kind: 'document', title: local.title })
      continue
    }

    const updatedAt = new Date().toISOString()
    const body = {
      title: local.title,
      content: parseCloudJson(local.content, { blocks: [] }),
      version: local.version,
      updated_by: session.profile,
      updated_at: updatedAt
    }

    if (!remote) {
      await cloudRequest('/rest/v1/indra_documents', {
        method: 'POST',
        token,
        prefer: 'return=minimal',
        body: [
          {
            ...body,
            id: map.cloud_id,
            project_id: cloudId,
            created_by: session.profile,
            created_at: iso(local.updated_at)
          }
        ]
      })
    } else {
      const guard = map.force
        ? `id=eq.${encodeURIComponent(map.cloud_id)}`
        : `id=eq.${encodeURIComponent(map.cloud_id)}&updated_at=eq.${encodeURIComponent(iso(remote.updated_at))}`
      const written = await cloudRequest<Array<{ id: string }>>(
        `/rest/v1/indra_documents?${guard}&select=id`,
        { method: 'PATCH', token, prefer: 'return=representation', body }
      )
      if (!written || written.length === 0) {
        conflict(projectId, 'document', local.id, local.title)
        conflicts.push({ kind: 'document', title: local.title })
        continue
      }
    }

    writeMap.run(projectId, 'document', local.id, map.cloud_id, updatedAt, localHash)
    pushed += 1
  }

  /* --- decks, pushed --- */
  const localPres = db
    .prepare('SELECT id, title, theme, conversion_mode, updated_at FROM presentations WHERE project_id = ?')
    .all(projectId) as unknown as LocalPresentation[]
  const cloudPresById = new Map(cloudPres.map((entry) => [entry.id, entry]))

  for (const local of localPres) {
    const map = byLocal.get(`presentation:${local.id}`)
    const localHash = presentationHash(local)
    const slides = localSlides(local.id)

    if (!map) {
      const id = `${cloudId}:p:${randomUUID()}`
      const updatedAt = new Date().toISOString()
      await cloudRequest('/rest/v1/indra_presentations', {
        method: 'POST',
        token,
        prefer: 'return=minimal',
        body: [
          {
            id,
            project_id: cloudId,
            title: local.title,
            theme: local.theme,
            conversion_mode: ['blank', 'rule', 'ai'].includes(local.conversion_mode)
              ? local.conversion_mode
              : 'blank',
            created_by: session.profile,
            created_at: iso(local.updated_at),
            updated_at: updatedAt
          }
        ]
      })
      await writeSlides(token, id, slides)
      writeMap.run(projectId, 'presentation', local.id, id, updatedAt, localHash)
      pushed += 1
      continue
    }

    if (localHash === map.synced_hash) continue
    const remote = cloudPresById.get(map.cloud_id)
    const remoteChanged = remote ? iso(remote.updated_at) !== iso(map.synced_at) : false
    if (remoteChanged && !map.force) {
      conflict(projectId, 'presentation', local.id, local.title)
      conflicts.push({ kind: 'presentation', title: local.title })
      continue
    }

    const updatedAt = new Date().toISOString()
    const written = await cloudRequest<Array<{ id: string }>>(
      `/rest/v1/indra_presentations?id=eq.${encodeURIComponent(map.cloud_id)}` +
        (map.force ? '' : `&updated_at=eq.${encodeURIComponent(iso(remote?.updated_at ?? map.synced_at))}`) +
        '&select=id',
      {
        method: 'PATCH',
        token,
        prefer: 'return=representation',
        body: {
          title: local.title,
          theme: local.theme,
          conversion_mode: ['blank', 'rule', 'ai'].includes(local.conversion_mode)
            ? local.conversion_mode
            : 'blank',
          updated_at: updatedAt
        }
      }
    )
    if (!written || written.length === 0) {
      conflict(projectId, 'presentation', local.id, local.title)
      conflicts.push({ kind: 'presentation', title: local.title })
      continue
    }
    await writeSlides(token, map.cloud_id, slides)
    writeMap.run(projectId, 'presentation', local.id, map.cloud_id, updatedAt, localHash)
    pushed += 1
  }

  const syncedAt = new Date().toISOString()
  db.prepare(
    `UPDATE cloud_saves SET last_sync_at = ?, document_count = ?, presentation_count = ?,
       owner_profile = ?, owner_name = ? WHERE project_id = ?`
  ).run(syncedAt, localDocs.length, localPres.length, owner.id, clean(owner.display_name, 'The head developer'), projectId)

  return {
    projectId,
    cloudId,
    pulled,
    pushed,
    syncedAt,
    conflicts: dedupeConflicts(conflicts)
  }
}

async function writeSlides(
  token: string,
  cloudPresentationId: string,
  slides: LocalSlide[]
): Promise<void> {
  await cloudRequest(`/rest/v1/indra_presentation_slides?presentation_id=eq.${encodeURIComponent(cloudPresentationId)}`, {
    method: 'DELETE',
    token,
    prefer: 'return=minimal'
  })
  if (slides.length === 0) return
  await cloudRequest('/rest/v1/indra_presentation_slides', {
    method: 'POST',
    token,
    prefer: 'return=minimal',
    body: slides.map((slide, index) => ({
      id: `${cloudPresentationId}:s:${randomUUID()}`,
      presentation_id: cloudPresentationId,
      position: index,
      layout: slide.layout,
      content: parseCloudJson(slide.content, {}),
      notes: slide.notes
    }))
  })
}

function dedupeConflicts(
  found: Array<{ kind: 'document' | 'presentation'; title: string }>
): Array<{ kind: 'document' | 'presentation'; title: string }> {
  const seen = new Set<string>()
  return found.filter((entry) => {
    const key = `${entry.kind}:${entry.title}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/* ---------------- deciding a conflict ---------------- */

/** The questions this project is waiting on an answer to. */
export function listConflicts(
  viewer: SessionUser,
  projectId: string
): Array<{ id: string; kind: 'document' | 'presentation'; title: string; detectedAt: string }> {
  getProject(viewer, projectId)
  const rows = getDatabase()
    .prepare(
      'SELECT id, kind, title, detected_at FROM cloud_conflicts WHERE project_id = ? ORDER BY detected_at'
    )
    .all(projectId) as unknown as Array<{
    id: string
    kind: 'document' | 'presentation'
    title: string
    detected_at: string
  }>
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    detectedAt: iso(row.detected_at)
  }))
}

/**
 * A conflict is a question, not a state to live in. "Cloud" replaces this PC's
 * copy with the one from the other machine; "mine" pushes this one over it on
 * the next sync. Either way the question is answered once.
 */
export async function resolveConflict(
  viewer: SessionUser,
  conflictId: string,
  choice: 'cloud' | 'local'
): Promise<ProjectDetail> {
  const db = getDatabase()
  const row = db
    .prepare('SELECT id, project_id, kind, local_id FROM cloud_conflicts WHERE id = ?')
    .get(conflictId) as
    | { id: string; project_id: string; kind: 'document' | 'presentation'; local_id: string }
    | undefined
  if (!row) throw errors.notFound()
  getProject(viewer, row.project_id)

  if (choice === 'local') {
    db.prepare('UPDATE cloud_items SET force = 1 WHERE project_id = ? AND kind = ? AND local_id = ?').run(
      row.project_id,
      row.kind,
      row.local_id
    )
  }

  db.prepare('DELETE FROM cloud_conflicts WHERE id = ?').run(row.id)

  if (choice === 'cloud') {
    // Forget the local version's claim on the cloud row; the next sync takes
    // the cloud copy wholesale.
    db.prepare(
      'UPDATE cloud_items SET synced_at = NULL, synced_hash = NULL WHERE project_id = ? AND kind = ? AND local_id = ?'
    ).run(row.project_id, row.kind, row.local_id)
    await syncProject(viewer, row.project_id)
  }

  return getProject(viewer, row.project_id)
}
