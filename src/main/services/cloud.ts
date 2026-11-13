import { createHash, randomBytes } from 'node:crypto'
import { net } from 'electron'
import type {
  CloudPortrait,
  CloudProjectState,
  CloudProjectSummary,
  CloudPushResult,
  CloudState,
  ProjectArchive,
  ProjectDetail,
  SessionUser
} from '@shared/types'
import { WORKSPACE_BUCKET } from '@shared/workspace'
import { getDatabase } from '../db/database'
import { errors } from '../lib/errors'
import { liveAccount, sessionForLocalUser } from '../lib/accountSession'
import { sealSecret, unsealSecret } from '../lib/seal'
import {
  SupabaseError,
  supabaseConfigured,
  supabaseEndpoint,
  supabaseRequest
} from '../lib/supabase'
import { restoreArchive } from './archive'
import { recheckConnectivity } from './connectivity'

/*
 * The cloud copy.
 *
 * Everything the app does is local, and stays that way. This file is the
 * second copy: a project, its documents and its decks written to Postgres, so
 * the same installation can bring them back on another machine — or after this
 * one dies. It is never the working copy. It is never read while offline.
 *
 * Why this machine needs an identity
 * ----------------------------------
 * The cloud tables are protected by Row Level Security that starts at
 * `auth.uid()`. The app's accounts are local, with no Supabase identity, so a
 * request carrying only the publishable key can read nothing and write nothing
 * — which is correct, and is exactly why a key was never going to be enough.
 * Instead of weakening those policies, each installation gets a real Supabase
 * user of its own: an auto-confirmed account with a generated address and a
 * 32-byte password, the password sealed by the OS keystore on this machine.
 * The trigger in auth.sql turns that user into a profile with a member number,
 * and every project it writes is owned by that profile and invisible to every
 * other installation. There is no service key anywhere in this app.
 *
 * The password is kept, not just the refresh token, because a token can be
 * rotated away from the machine and a copy you can no longer reach is not a
 * backup.
 *
 * Push is a mirror, not a merge
 * -----------------------------
 * The machine that presses the button is the truth: the cloud project's
 * documents and decks are replaced with this project's. Merging two divergent
 * document trees without asking is how people lose work, and asking is a
 * dialog nobody reads. One rule, predictable.
 *
 * Nothing here runs until the user asks for it, and nothing here runs at all
 * when the machine has no route out.
 */

/*
 * One cloud identity per *account*, not per installation.
 *
 * Two people can sign in to this PC in turn, and they must not become the same
 * person in the cloud: an invitation is addressed to an address, and an
 * identity shared by everyone who uses the machine would let the wrong account
 * answer it. The keys carry the account id for that reason.
 *
 * Installations from before this change hold a single identity under the two
 * bare keys. It is adopted, once, by the first account that reaches for the
 * cloud — that account keeps the cloud copies it already had, and every other
 * account starts clean.
 */
const IDENTITY_PREFIX = 'cloud_identity'
const PROFILE_PREFIX = 'cloud_profile'
const TIMEOUT_MS = 15_000
const REFRESH_MARGIN_MS = 60_000

interface Identity {
  email: string
  /** Generated here; sealed with the identity, never shown or logged. */
  password: string
  uid: string
  accessToken: string
  refreshToken: string
  expiresAt: number
}

/* ---------------- local storage ---------------- */

/** jane@example.com -> ja•••@example.com. Never a credential, just a reminder. */
function maskEmail(email: string): string {
  const [name, domain] = String(email ?? '').split('@')
  if (!domain) return email
  const head = name.slice(0, 2)
  return `${head}${'•'.repeat(Math.max(3, name.length - 2))}@${domain}`
}

function readSetting(key: string): string | null {
  const row = getDatabase().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function writeSetting(key: string, value: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, new Date().toISOString())
}

function clearSetting(key: string): void {
  getDatabase().prepare('DELETE FROM app_settings WHERE key = ?').run(key)
}

function readIdentity(accountId: string): Identity | null {
  const stored = readSetting(`${IDENTITY_PREFIX}:${accountId}`)
  if (!stored) {
    // One-time adoption of an installation-wide identity from an older build.
    const legacy = readSetting(IDENTITY_PREFIX)
    if (!legacy) return null
    writeSetting(`${IDENTITY_PREFIX}:${accountId}`, legacy)
    clearSetting(IDENTITY_PREFIX)
    return readIdentity(accountId)
  }
  const raw = unsealSecret(stored).value
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<Identity>
    if (!parsed.email || !parsed.password || !parsed.uid) return null
    return {
      email: parsed.email,
      password: parsed.password,
      uid: parsed.uid,
      accessToken: parsed.accessToken ?? '',
      refreshToken: parsed.refreshToken ?? '',
      expiresAt: Number(parsed.expiresAt) || 0
    }
  } catch {
    return null
  }
}

function saveIdentity(accountId: string, identity: Identity): void {
  writeSetting(`${IDENTITY_PREFIX}:${accountId}`, sealSecret(JSON.stringify(identity)))
}

interface ProfileRecord {
  id: string
  contactEmail: string | null
  displayName: string | null
}

function readProfile(accountId: string): ProfileRecord | null {
  const stored = readSetting(`${PROFILE_PREFIX}:${accountId}`)
  if (!stored) {
    const legacy = readSetting(PROFILE_PREFIX)
    if (!legacy) return null
    writeSetting(`${PROFILE_PREFIX}:${accountId}`, legacy)
    clearSetting(PROFILE_PREFIX)
    return readProfile(accountId)
  }
  const raw = unsealSecret(stored).value
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { id?: unknown; contactEmail?: unknown; displayName?: unknown }
    return typeof parsed.id === 'string'
      ? {
          id: parsed.id,
          contactEmail: typeof parsed.contactEmail === 'string' ? parsed.contactEmail : null,
          displayName: typeof parsed.displayName === 'string' ? parsed.displayName : null
        }
      : null
  } catch {
    return null
  }
}

function saveProfile(accountId: string, record: ProfileRecord): void {
  writeSetting(`${PROFILE_PREFIX}:${accountId}`, sealSecret(JSON.stringify(record)))
}

/* ---------------- transport ---------------- */

/*
 * The project's HTTP door now lives in `lib/supabase.ts`: human sign-in needs
 * exactly the same one, and two auth clients is how a token ends up handled
 * differently in each. This wrapper keeps every call site below unchanged and
 * gives the one failure that deserves its own sentence — a request the server
 * never answered — the sentence it had before.
 */
async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string; prefer?: string } = {}
): Promise<T> {
  try {
    return await supabaseRequest<T>(path, options)
  } catch (error) {
    if (error instanceof SupabaseError && error.status === 0) {
      throw errors.cloud(
        'The cloud did not answer in time. Try again when the connection is steadier.'
      )
    }
    throw error
  }
}

function cloudConfigured(): boolean {
  // The publishable key is what the app ships with; a server-side secret key is
  // never used here even if someone pastes one into settings.
  return supabaseConfigured()
}

/** Where this installation talks to. Same resolution as `lib/supabase.ts`. */
function endpoint(): { url: string; key: string } {
  return supabaseEndpoint()
}

/**
 * Every network entry point starts here.
 *
 * The answer is asked of the operating system at the moment of the call rather
 * than read from the poll that feeds the renderer: a machine that lost its
 * route five seconds ago must not be given a request it will hang on.
 */
function assertReachable(): void {
  if (!cloudConfigured()) throw errors.cloud('No cloud is configured in this build.')
  if (!recheckConnectivity().online) {
    throw errors.cloud('This PC is offline. The cloud copy is not available.')
  }
}

/* ---------------- identity ---------------- */

interface AuthSession {
  access_token: string
  refresh_token: string
  expires_in?: number
  user?: { id: string; email?: string }
}

function fromSession(session: AuthSession, base: Pick<Identity, 'email' | 'password'>): Identity {
  if (!session.access_token || !session.user?.id) {
    throw errors.cloud('The cloud would not create an identity for this PC.')
  }
  return {
    email: base.email,
    password: base.password,
    uid: session.user.id,
    accessToken: session.access_token,
    refreshToken: session.refresh_token ?? '',
    expiresAt: Date.now() + Math.max(60, session.expires_in ?? 3600) * 1000
  }
}

/** A generated address the account can never lose: this machine owns it. */
function deviceEmail(): string {
  return `device-${randomBytes(8).toString('hex')}@device.indra.hub`
}

function devicePassword(): string {
  return randomBytes(32).toString('base64url')
}

async function signUp(): Promise<Identity> {
  const email = deviceEmail()
  const password = devicePassword()
  const session = await request<AuthSession>('/auth/v1/signup', {
    method: 'POST',
    body: { email, password }
  })
  return fromSession(session, { email, password })
}

async function signInWithPassword(identity: Identity): Promise<Identity> {
  const session = await request<AuthSession>('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: identity.email, password: identity.password }
  })
  return fromSession(session, identity)
}

async function refresh(identity: Identity): Promise<Identity> {
  if (!identity.refreshToken) return signInWithPassword(identity)
  const session = await request<AuthSession>('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: { refresh_token: identity.refreshToken }
  })
  return fromSession(session, identity)
}

/**
 * The identity behind the cloud copies.
 *
 * For a connected INDRA account this is the human's own Supabase session, so a
 * project pushed from this PC belongs to the person rather than to the machine.
 * That is the whole point of the migration: the same account on two PCs is one
 * owner, one member row, one set of permissions.
 *
 * An account that has not been connected yet keeps the old per-installation
 * identity, so nothing that already works stops working before its owner has
 * signed up. `identityForKey` below remains for that path and for the credit
 * console, which keys on `admin:<adminId>`.
 */
async function identity(viewer: SessionUser): Promise<Identity> {
  const human = sessionForLocalUser(viewer.id)
  if (human) {
    const live = await liveAccount()
    return {
      email: live.email,
      // A human's password is never stored, so there is nothing to re-sign-in
      // with; `liveAccount()` refreshes from the sealed refresh token instead.
      password: '',
      uid: live.uid,
      accessToken: live.accessToken,
      refreshToken: live.refreshToken,
      expiresAt: live.expiresAt
    }
  }
  return identityForKey(viewer.id)
}

/**
 * The stored cloud identity for a key, created on first use and refreshed a
 * minute before it expires. A workspace account keys on its user id; the credit
 * console keys on `admin:<adminId>`, so one can never be mistaken for the other.
 */
async function identityForKey(key: string): Promise<Identity> {
  let current = readIdentity(key)
  if (!current) {
    current = await signUp()
    saveIdentity(key, current)
    return current
  }
  if (current.expiresAt - REFRESH_MARGIN_MS > Date.now()) return current

  const renewed = await refresh(current).catch(() => signInWithPassword(current))
  saveIdentity(key, renewed)
  return renewed
}

/**
 * The profile row auth.sql's trigger created for this identity, and the one
 * field the trigger could not know: the address this person answers cloud
 * invitations at.
 *
 * The address is written once — and again only if the account it belongs to
 * changes it — so the common path costs no request at all.
 */
async function profileFor(viewer: SessionUser, actor: Identity): Promise<string> {
  /*
   * A connected account already knows its profile: sign-in resolved it and
   * stored it with the session. Nothing is written here — the profile row is the
   * server's, and `contact_email` was set at sign-in from a verified address.
   */
  const human = sessionForLocalUser(viewer.id)
  if (human?.profileId) return human.profileId

  const address = viewer.email.trim().toLowerCase()
  const name = viewer.displayName.trim()
  const known = readProfile(viewer.id)
  if (known && known.contactEmail === address && known.displayName === name) return known.id

  if (known) {
    await request(`/rest/v1/indra_users?id=eq.${encodeURIComponent(known.id)}`, {
      method: 'PATCH',
      token: actor.accessToken,
      prefer: 'return=minimal',
      body: { contact_email: address, display_name: name }
    })
    saveProfile(viewer.id, { id: known.id, contactEmail: address, displayName: name })
    return known.id
  }

  const rows = await request<{ id: string }[]>(
    `/rest/v1/indra_users?select=id&auth_user_id=eq.${encodeURIComponent(actor.uid)}`,
    { token: actor.accessToken }
  )
  const id = rows?.[0]?.id
  if (!id) throw errors.cloud('This PC’s cloud profile has not been created yet. Try again in a moment.')

  await request(`/rest/v1/indra_users?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    token: actor.accessToken,
    prefer: 'return=minimal',
    body: { contact_email: address, display_name: name }
  })
  saveProfile(viewer.id, { id, contactEmail: address, displayName: name })
  return id
}

/* ---------------- one door for the rest of the app ---------------- */

export interface CloudSession {
  token: string
  /** This account's cloud profile id, and the id the RLS policies compare to. */
  profile: string
  uid: string
}

/**
 * Everything a cloud call needs, resolved once: the account's own identity,
 * a fresh token, and the profile row behind it. Refused while offline, which
 * is what keeps the cloud off the offline workspace's path entirely.
 */
export async function cloudSession(viewer: SessionUser): Promise<CloudSession> {
  assertReachable()
  const actor = await identity(viewer)
  const profile = await profileFor(viewer, actor)
  return { token: actor.accessToken, profile, uid: actor.uid }
}

/** Exposed to the sharing service so there is one transport, not two. */
export const cloudRequest = request

/* ------------------------------------------------------------------ */
/* The profile picture, on the server                                  */
/* ------------------------------------------------------------------ */

/*
 * A portrait has always been a file on one PC. This is the second copy, in the
 * workspace bucket, addressed by the Supabase identity that owns it:
 *
 *   indra-media/portraits/<uid>/<media id>.<ext>
 *
 * The bucket's write policy allows a signed-in person to write only under their
 * own uid, and `indra_set_my_portrait` refuses a path that is not theirs, so a
 * portrait cannot be written over somebody else's. Both checks exist on the
 * server; neither is trusted from here.
 *
 * Every function below is additive and best-effort. A picture is saved locally
 * whether or not the server answers, and nothing in the app reads the server
 * copy to draw a picture — the local file is still what the account shows.
 */

const PORTRAIT_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function portraitExtension(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

/**
 * Uploads one portrait and records where it lives. Resolves to the storage path
 * when both steps succeeded, and to null when they did not — never throws, so a
 * caller can fire it and forget it.
 */
export async function publishPortrait(
  viewer: SessionUser,
  mediaId: string,
  bytes: Buffer,
  mime: string
): Promise<string | null> {
  if (!PORTRAIT_MIMES.has(mime) || bytes.length === 0) return null
  try {
    const session = await cloudSession(viewer)
    const path = `portraits/${session.uid}/${mediaId}.${portraitExtension(mime)}`
    const { url, key } = endpoint()
    const response = await net.fetch(
      `${url}/storage/v1/object/${WORKSPACE_BUCKET}/${encodeURI(path)}`,
      {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${session.token}`,
          'Content-Type': mime,
          // A new picture replaces the old one at the same address.
          'x-upsert': 'true'
        },
        body: bytes
      }
    )
    if (!response.ok) return null

    await request('/rest/v1/rpc/indra_set_my_portrait', {
      method: 'POST',
      token: session.token,
      body: { p_path: path, p_mime: mime, p_bytes: bytes.length }
    })
    return path
  } catch {
    return null
  }
}

/** What the account's cloud profile says about its picture, if anything. */
export async function portraitOnServer(viewer: SessionUser): Promise<CloudPortrait> {
  const empty: CloudPortrait = { reachable: false, path: null, mime: null, bytes: 0, updatedAt: null }
  try {
    const session = await cloudSession(viewer)
    const row = await request<{
      path: string | null
      mime: string | null
      bytes: number | null
      updatedAt: string | null
    } | null>('/rest/v1/rpc/indra_portrait_of', {
      method: 'POST',
      token: session.token,
      body: { p_user: session.profile }
    })
    return {
      reachable: true,
      path: row?.path ?? null,
      mime: row?.mime ?? null,
      bytes: Number(row?.bytes ?? 0),
      updatedAt: row?.updatedAt ?? null
    }
  } catch {
    return empty
  }
}

/* ------------------------------------------------------------------ */
/* The administrator's own cloud identity                              */
/* ------------------------------------------------------------------ */

/**
 * The credit console is a property of the *installation's* administrator, not
 * of whoever happens to be signed in to the workspace.
 *
 * Those are two different things, and confusing them is what made the console
 * unusable: every call resolved the caller with `requireUser()`, so an
 * administrator who had signed in to the admin panel — and nobody else — was
 * told "Sign in to continue." and could change nothing. The console now has its
 * own identity, created on first use, kept apart from any workspace account, and
 * readable only from an administrator session (the IPC layer is what enforces
 * that; this function is not reachable from the renderer).
 *
 * Whether that identity may actually change anything is still decided by the
 * server: `indra_is_admin()` reads `indra_users.role` for this identity, and a
 * new identity is a plain member until the first ever administrator claims the
 * role. Nothing here can forge it.
 */
export async function adminCloudSession(adminId: string): Promise<CloudSession> {
  assertReachable()
  const actor = await identityForKey(`admin:${adminId}`)
  return { token: actor.accessToken, profile: '', uid: actor.uid }
}

/*
 * One request on behalf of *this installation's administrator*, not a workspace
 * member. Used by the console to read things the server guards with
 * indra_is_admin(), and by nothing else.
 */
export async function adminCloudRequest<T = unknown>(
  adminId: string,
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const session = await adminCloudSession(adminId)
  return request<T>(path, {
    method: options.method,
    body: options.body,
    token: session.token,
    prefer: 'return=representation'
  })
}

/**
 * The role this installation's administrator holds on the server, if any.
 *
 * `take` is a deliberate act, never a side effect of opening a panel: it calls
 * the server's repair function, which refuses to displace an active
 * administrator and only ever fills an unowned role. Without it, a project whose
 * administrator profile was created and then abandoned has no way back.
 */
export async function adminCloudRole(
  adminId: string,
  take = false
): Promise<{ isAdmin: boolean; refused: string | null; email: string | null }> {
  const state = await adminCloudRequest<{ isAdmin?: boolean }>(adminId, '/rest/v1/rpc/indra_credit_state', {
    method: 'POST',
    body: {}
  })
  let refused: string | null = null

  if (state?.isAdmin !== true && take) {
    const result = await adminCloudRequest<{ claimed?: boolean; reason?: string | null }>(
      adminId,
      '/rest/v1/rpc/indra_claim_credit_admin',
      { method: 'POST', body: {} }
    ).catch((error: unknown) =>
      // The server's refusal is the useful part of a failure here.
      ({ claimed: false, reason: error instanceof Error ? error.message : 'The server refused.' })
    )
    if (result?.claimed !== true) refused = result?.reason ?? 'The server did not grant the role.'
  }

  const after = state?.isAdmin === true
    ? state
    : await adminCloudRequest<{ isAdmin?: boolean }>(adminId, '/rest/v1/rpc/indra_credit_state', {
        method: 'POST',
        body: {}
      }).catch(() => state)

  return {
    isAdmin: after?.isAdmin === true,
    refused,
    email: (await identityEmail(adminId)) ?? null
  }
}

/**
 * Which cloud account this installation's credit console is speaking as.
 *
 * Exposed because it is the fact that made a support case impossible to
 * diagnose: two PCs can both hold the credit role and there was no way, from
 * inside the app, to say which sealed identity either of them was using. An
 * administrator who reinstalls gets a new identity, the old one keeps the role,
 * and the panel simply said the role was not granted — true, and useless.
 */
export async function adminCloudIdentity(
  adminId: string
): Promise<{ email: string | null; uid: string | null }> {
  const session = await adminCloudSession(adminId)
  return { email: (await identityEmail(adminId)) ?? null, uid: session.uid }
}

/** The account address the cloud issued to this administrator's identity. */
async function identityEmail(adminId: string): Promise<string | null> {
  const stored = readSetting(`${IDENTITY_PREFIX}:admin:${adminId}`)
  if (!stored) return null
  try {
    const raw = unsealSecret(stored).value
    if (!raw) return null
    const parsed = JSON.parse(raw) as { email?: unknown }
    return typeof parsed.email === 'string' ? parsed.email : null
  } catch {
    return null
  }
}

/**
 * The two things the AI service needs from this file: the endpoint (so a call
 * to the Edge Function goes to the same project as everything else) and the
 * same "is there a route out" answer every other cloud call is refused by.
 */
export const cloudEndpoint = endpoint

/** Throws the offline message when the machine has no route out. */
export function assertCloudReachable(): void {
  assertReachable()
}
export { parseJson as parseCloudJson }

/* ---------------- local ids in the cloud ---------------- */

/**
 * Cloud rows are named after the local project they came from, with a prefix,
 * so two projects that happen to hold a document with the same id can never
 * collide on the cloud side, and a push is idempotent.
 */
function cloudProjectId(projectId: string): string {
  const row = getDatabase()
    .prepare('SELECT cloud_project_id FROM cloud_saves WHERE project_id = ?')
    .get(projectId) as { cloud_project_id: string } | undefined
  return row?.cloud_project_id ?? projectId
}

function cloudDocumentId(projectId: string, documentId: string): string {
  return `${cloudProjectId(projectId)}:d:${documentId}`
}

function cloudPresentationId(projectId: string, presentationId: string): string {
  return `${cloudProjectId(projectId)}:p:${presentationId}`
}

function cloudSlideId(presentationId: string, slideId: string): string {
  return `${presentationId}:s:${slideId}`
}

/* ---------------- local state ---------------- */

interface LocalProject {
  id: string
  name: string
  description: string
  owner_id: string
}

function localProject(viewer: SessionUser, projectId: string): LocalProject {
  const row = getDatabase()
    .prepare('SELECT id, name, description, owner_id FROM projects WHERE id = ?')
    .get(projectId) as LocalProject | undefined
  if (!row) throw errors.notFound()
  // Visibility first, locally: a project this account cannot open never
  // reaches the network.
  if (row.owner_id !== viewer.id) {
    const member = getDatabase()
      .prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?')
      .get(projectId, viewer.id)
    if (!member) throw errors.notFound()
  }
  return row
}

export function cloudProjectState(viewer: SessionUser, projectId: string): CloudProjectState {
  const project = localProject(viewer, projectId)
  const save = getDatabase()
    .prepare(
      `SELECT cloud_project_id, pushed_at, document_count, presentation_count,
              role, owner_name, last_sync_at
         FROM cloud_saves WHERE project_id = ?`
    )
    .get(projectId) as
    | {
        cloud_project_id: string
        pushed_at: string
        document_count: number
        presentation_count: number
        role: 'owner' | 'member'
        owner_name: string | null
        last_sync_at: string | null
      }
    | undefined

  if (!save) {
    return {
      projectId,
      cloudId: null,
      pushedAt: null,
      documents: 0,
      presentations: 0,
      stale: project.owner_id === viewer.id,
      shared: false,
      role: project.owner_id === viewer.id ? 'owner' : 'member',
      ownerName: null,
      lastSyncAt: null,
      conflicts: 0
    }
  }

  // Staleness is a local question — timestamps already on disk — so the badge
  // still says something useful offline.
  const latest = getDatabase()
    .prepare(
      `SELECT MAX(at) AS at FROM (
         SELECT updated_at AS at FROM projects WHERE id = ?1
         UNION ALL SELECT updated_at FROM documents WHERE project_id = ?1
         UNION ALL SELECT updated_at FROM presentations WHERE project_id = ?1
       )`
    )
    .get(projectId) as { at: string | null } | undefined

  const conflicts = getDatabase()
    .prepare('SELECT COUNT(*) AS n FROM cloud_conflicts WHERE project_id = ?')
    .get(projectId) as { n: number } | undefined

  return {
    projectId,
    cloudId: save.cloud_project_id,
    pushedAt: save.pushed_at,
    documents: Number(save.document_count) || 0,
    presentations: Number(save.presentation_count) || 0,
    // A shared project is "behind" when either side has moved, and only the
    // network can answer that; the badge therefore speaks about local work.
    stale: Boolean(latest?.at && latest.at > (save.last_sync_at ?? save.pushed_at)),
    shared: save.role === 'member',
    role: save.role,
    ownerName: save.owner_name,
    lastSyncAt: save.last_sync_at,
    conflicts: Number(conflicts?.n) || 0
  }
}

export async function cloudState(viewer: SessionUser): Promise<CloudState> {
  const online = recheckConnectivity().online
  if (!cloudConfigured()) {
    return {
      available: false,
      linked: false,
      account: null,
      online,
      message: 'No cloud is configured in this build.'
    }
  }

  const current = readIdentity(viewer.id)
  return {
    available: true,
    linked: Boolean(current),
    // The address a person recognises is their own; the generated identity
    // behind it is never shown.
    account: current ? maskEmail(viewer.email) : null,
    online,
    message: online ? null : 'Offline. The cloud copy is hidden until this PC is back online.'
  }
}

/* ---------------- push ---------------- */

interface LocalDocument {
  id: string
  title: string
  content: string
  version: number
  created_at: string
  updated_at: string
}

interface LocalPresentation {
  id: string
  title: string
  theme: string
  conversion_mode: string
  created_at: string
  updated_at: string
}

interface LocalSlide {
  id: string
  presentation_id: string
  position: number
  layout: string
  content: string
  notes: string
}

function parseJson(raw: string, fallback: unknown): unknown {
  if (!raw) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

/**
 * Writes this project, its documents and its decks to the cloud as this
 * installation's own copy, replacing what was there.
 *
 * Each table is deleted and rewritten rather than upserted: the app's column
 * grants deliberately allow updating only a project's name, description and
 * timestamps, so an upsert that touched anything else would be refused by the
 * database. Replace is also the honest expression of what the button says.
 */
export async function pushProject(
  viewer: SessionUser,
  projectId: string
): Promise<CloudPushResult> {
  const project = localProject(viewer, projectId)
  if (project.owner_id !== viewer.id) {
    // A member's changes live in their own local database; the owner's copy is
    // the one that owns the cloud project. Saying so is better than writing a
    // row the database would refuse anyway.
    throw errors.forbidden('Only the head developer can save this project to the cloud.')
  }

  /*
   * Replace-everything is right for a backup and wrong for a project somebody
   * else is working on: it would delete the rows their work is in. Once a
   * shared project has a member on another PC, the way to the cloud is Sync.
   */
  const collaborators = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS n
         FROM project_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.project_id = ? AND u.remote_profile IS NOT NULL`
    )
    .get(projectId) as { n: number } | undefined
  if (Number(collaborators?.n) > 0) {
    throw errors.validation(
      'This project is shared with another PC. Use Sync, so nobody’s work is overwritten.'
    )
  }

  assertReachable()

  const actor = await identity(viewer)
  const profile = await profileFor(viewer, actor)
  const cloudId = cloudProjectId(projectId)
  const now = new Date().toISOString()
  const token = actor.accessToken

  const documents = getDatabase()
    .prepare(
      'SELECT id, title, content, version, created_at, updated_at FROM documents WHERE project_id = ? ORDER BY created_at'
    )
    .all(projectId) as unknown as LocalDocument[]

  const presentations = getDatabase()
    .prepare(
      `SELECT id, title, theme, conversion_mode, created_at, updated_at
         FROM presentations WHERE project_id = ? ORDER BY created_at`
    )
    .all(projectId) as unknown as LocalPresentation[]

  const slides =
    presentations.length === 0
      ? []
      : (getDatabase()
          .prepare(
            `SELECT s.id, s.presentation_id, s.position, s.layout, s.content, s.notes
               FROM presentation_slides s
               JOIN presentations p ON p.id = s.presentation_id
              WHERE p.project_id = ?
              ORDER BY s.position`
          )
          .all(projectId) as unknown as LocalSlide[])

  /*
   * The project row itself. Inserted only if absent, then patched with the
   * columns the grants allow, so a re-push updates rather than duplicates.
   */
  await request('/rest/v1/indra_projects?on_conflict=id', {
    method: 'POST',
    token,
    prefer: 'resolution=ignore-duplicates,return=minimal',
    body: [
      {
        id: cloudId,
        name: project.name,
        description: project.description,
        owner_id: profile,
        created_at: now,
        updated_at: now
      }
    ]
  })
  await request(`/rest/v1/indra_projects?id=eq.${encodeURIComponent(cloudId)}`, {
    method: 'PATCH',
    token,
    prefer: 'return=minimal',
    body: { name: project.name, description: project.description, updated_at: now }
  })

  // Documents first: deleting them cascades their versions, which keeps the
  // cloud copy exactly as large as the local one.
  await request(`/rest/v1/indra_documents?project_id=eq.${encodeURIComponent(cloudId)}`, {
    method: 'DELETE',
    token,
    prefer: 'return=minimal'
  })
  if (documents.length > 0) {
    await request('/rest/v1/indra_documents', {
      method: 'POST',
      token,
      prefer: 'return=minimal',
      body: documents.map((document) => ({
        id: cloudDocumentId(projectId, document.id),
        project_id: cloudId,
        title: document.title,
        content: parseJson(document.content, { blocks: [] }),
        version: document.version,
        created_by: profile,
        updated_by: profile,
        created_at: document.created_at,
        updated_at: document.updated_at
      }))
    })
  }

  await request(`/rest/v1/indra_presentations?project_id=eq.${encodeURIComponent(cloudId)}`, {
    method: 'DELETE',
    token,
    prefer: 'return=minimal'
  })
  if (presentations.length > 0) {
    await request('/rest/v1/indra_presentations', {
      method: 'POST',
      token,
      prefer: 'return=minimal',
      body: presentations.map((presentation) => ({
        id: cloudPresentationId(projectId, presentation.id),
        project_id: cloudId,
        title: presentation.title,
        theme: presentation.theme,
        // The cloud column is a checked enum; anything else is a blank deck.
        conversion_mode: ['blank', 'rule', 'ai'].includes(presentation.conversion_mode)
          ? presentation.conversion_mode
          : 'blank',
        created_by: profile,
        created_at: presentation.created_at,
        updated_at: presentation.updated_at
      }))
    })

    if (slides.length > 0) {
      await request('/rest/v1/indra_presentation_slides', {
        method: 'POST',
        token,
        prefer: 'return=minimal',
        body: slides.map((slide) => ({
          id: cloudSlideId(cloudPresentationId(projectId, slide.presentation_id), slide.id),
          presentation_id: cloudPresentationId(projectId, slide.presentation_id),
          position: slide.position,
          layout: slide.layout,
          content: parseJson(slide.content, {}),
          notes: slide.notes
        }))
      })
    }
  }

  /*
   * The join between these local rows and the cloud rows just written.
   *
   * Without it a later sync would see every local item as new and send a
   * second copy of the whole project. The hash is the test for "changed since
   * we last agreed", so a push and a sync tell the same story.
   */
  const digest = (value: unknown): string =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const map = getDatabase().prepare(
    `INSERT INTO cloud_items (project_id, kind, local_id, cloud_id, synced_at, synced_hash, force)
     VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(project_id, kind, local_id) DO UPDATE SET
       cloud_id = excluded.cloud_id, synced_at = excluded.synced_at, synced_hash = excluded.synced_hash`
  )
  for (const document of documents) {
    map.run(
      projectId,
      'document',
      document.id,
      cloudDocumentId(projectId, document.id),
      document.updated_at,
      digest({ title: document.title, content: document.content })
    )
  }
  for (const presentation of presentations) {
    const mine = slides
      .filter((slide) => slide.presentation_id === presentation.id)
      .map((slide) => ({ layout: slide.layout, content: parseJson(slide.content, {}), notes: slide.notes }))
    map.run(
      projectId,
      'presentation',
      presentation.id,
      cloudPresentationId(projectId, presentation.id),
      presentation.updated_at,
      digest({ title: presentation.title, theme: presentation.theme, slides: mine })
    )
  }

  getDatabase()
    .prepare(
      `INSERT INTO cloud_saves
         (project_id, cloud_project_id, pushed_at, document_count, presentation_count)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         cloud_project_id   = excluded.cloud_project_id,
         pushed_at          = excluded.pushed_at,
         document_count     = excluded.document_count,
         presentation_count = excluded.presentation_count`
    )
    .run(projectId, cloudId, now, documents.length, presentations.length)

  return {
    cloudId,
    pushedAt: now,
    documents: documents.length,
    presentations: presentations.length
  }
}

/* ---------------- read back ---------------- */

interface CloudProjectRow {
  id: string
  name: string
  description: string
  updated_at: string
}

/**
 * The projects in this installation's cloud copy.
 *
 * Everything goes through the device identity's own token, so Row Level
 * Security — not this query — decides what comes back: `owner_id` is a filter
 * for speed, never the security boundary.
 */
export async function listCloudProjects(viewer: SessionUser): Promise<CloudProjectSummary[]> {
  assertReachable()
  const actor = await identity(viewer)
  await profileFor(viewer, actor)

  // The RPC returns everything this account can open — its own copies and the
  // projects shared with it — and names the owner, which a member needs to
  // recognise a project that is not theirs.
  const rows = await request<Array<CloudProjectRow & { owner_name: string; is_owner: boolean }>>(
    '/rest/v1/rpc/indra_my_projects',
    { method: 'POST', token: actor.accessToken, body: {} }
  )

  const links = new Map(
    (
      getDatabase().prepare('SELECT project_id, cloud_project_id FROM cloud_saves').all() as Array<{
        project_id: string
        cloud_project_id: string
      }>
    ).map((row) => [row.cloud_project_id, row.project_id])
  )

  return (rows ?? []).map((row) => ({
    cloudId: row.id,
    name: row.name,
    description: row.description ?? '',
    updatedAt: row.updated_at,
    localProjectId: links.get(row.id) ?? null,
    ownerName: row.owner_name ?? null,
    isOwner: row.is_owner !== false
  }))
}

interface CloudDocumentRow {
  id: string
  title: string
  content: { blocks?: unknown } | null
  created_at: string
  updated_at: string
}

interface CloudPresentationRow {
  id: string
  title: string
  theme: string
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

function quoteList(values: string[]): string {
  return `(${values.map((value) => `"${value.replace(/["\\]/g, '')}"`).join(',')})`
}

/**
 * Brings a cloud project down as a new local project.
 *
 * The rows are assembled into the same archive the "copy on this PC" file uses
 * and handed to the same restore path, so a pulled project is parsed,
 * sanitised and validated exactly like an imported file — one way in, one set
 * of rules. The new project remembers which cloud project it came from, so
 * pushing it later updates that copy instead of making another one.
 */
export async function pullProject(
  viewer: SessionUser,
  cloudId: string
): Promise<ProjectDetail> {
  assertReachable()
  const actor = await identity(viewer)
  await profileFor(viewer, actor)
  const token = actor.accessToken
  // Access is the database's decision, not this filter's: a member pulling a
  // shared project is exactly the case the policies were built for.
  const filter = `id=eq.${encodeURIComponent(cloudId)}`

  const [projectRow] = await request<CloudProjectRow[]>(
    `/rest/v1/indra_projects?select=id,name,description,updated_at&${filter}`,
    { token }
  )
  if (!projectRow) throw errors.notFound('That project is not in this PC’s cloud copy.')

  const documents = await request<CloudDocumentRow[]>(
    `/rest/v1/indra_documents?select=id,title,content,created_at,updated_at&project_id=eq.${encodeURIComponent(cloudId)}&order=updated_at.desc`,
    { token }
  )

  const presentations = await request<CloudPresentationRow[]>(
    `/rest/v1/indra_presentations?select=id,title,theme,created_at,updated_at&project_id=eq.${encodeURIComponent(cloudId)}&order=updated_at.desc`,
    { token }
  )

  const slides =
    presentations.length > 0
      ? await request<CloudSlideRow[]>(
          `/rest/v1/indra_presentation_slides?select=id,presentation_id,position,layout,content,notes&presentation_id=in.${quoteList(
            presentations.map((presentation) => presentation.id)
          )}&order=position`,
          { token }
        )
      : []

  const archive: ProjectArchive = {
    format: 'indrahub.project',
    version: 1,
    exportedAt: new Date().toISOString(),
    project: { name: projectRow.name, description: projectRow.description ?? '' },
    documents: (documents ?? []).map((document) => ({
      title: document.title,
      blocks: document.content?.blocks ?? [],
      createdAt: document.created_at,
      updatedAt: document.updated_at
    })),
    presentations: (presentations ?? []).map((presentation) => ({
      title: presentation.title,
      theme: presentation.theme,
      slides: (slides ?? [])
        .filter((slide) => slide.presentation_id === presentation.id)
        .sort((a, b) => a.position - b.position)
        .map((slide) => ({
          ...(slide.content ?? {}),
          layout: slide.layout,
          notes: slide.notes ?? ''
        })),
      createdAt: presentation.created_at,
      updatedAt: presentation.updated_at
    }))
  }

  const project = restoreArchive(viewer, JSON.stringify(archive))

  // The copy knows where it came from: a later push updates this cloud
  // project rather than adding a second one, and each local item remembers the
  // cloud row it came from, so a sync does not send a second copy of it.
  const digest = (value: unknown): string =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const map = getDatabase().prepare(
    `INSERT INTO cloud_items (project_id, kind, local_id, cloud_id, synced_at, synced_hash, force)
     VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(project_id, kind, local_id) DO UPDATE SET
       cloud_id = excluded.cloud_id, synced_at = excluded.synced_at, synced_hash = excluded.synced_hash`
  )
  const localDocs = getDatabase()
    .prepare('SELECT id, title, content FROM documents WHERE project_id = ? ORDER BY created_at')
    .all(project.id) as unknown as Array<{ id: string; title: string; content: string }>
  for (const cloudDoc of documents ?? []) {
    const index = localDocs.findIndex((row) => row.title === cloudDoc.title)
    const local = index >= 0 ? localDocs.splice(index, 1)[0] : undefined
    if (!local) continue
    map.run(
      project.id,
      'document',
      local.id,
      cloudDoc.id,
      new Date(cloudDoc.updated_at).toISOString(),
      digest({ title: local.title, content: local.content })
    )
  }

  const localDecks = getDatabase()
    .prepare('SELECT id, title, theme FROM presentations WHERE project_id = ? ORDER BY created_at')
    .all(project.id) as unknown as Array<{ id: string; title: string; theme: string }>
  for (const cloudDeck of presentations ?? []) {
    const index = localDecks.findIndex((row) => row.title === cloudDeck.title)
    const local = index >= 0 ? localDecks.splice(index, 1)[0] : undefined
    if (!local) continue
    const mine = getDatabase()
      .prepare(
        'SELECT layout, content, notes FROM presentation_slides WHERE presentation_id = ? ORDER BY position'
      )
      .all(local.id) as unknown as Array<{ layout: string; content: string; notes: string }>
    map.run(
      project.id,
      'presentation',
      local.id,
      cloudDeck.id,
      new Date(cloudDeck.updated_at).toISOString(),
      digest({
        title: local.title,
        theme: local.theme,
        slides: mine.map((slide) => ({
          layout: slide.layout,
          content: parseJson(slide.content, {}),
          notes: slide.notes
        }))
      })
    )
  }

  getDatabase()
    .prepare(
      `INSERT INTO cloud_saves
         (project_id, cloud_project_id, pushed_at, document_count, presentation_count)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET cloud_project_id = excluded.cloud_project_id,
         pushed_at = excluded.pushed_at, document_count = excluded.document_count,
         presentation_count = excluded.presentation_count`
    )
    .run(
      project.id,
      cloudId,
      new Date().toISOString(),
      archive.documents.length,
      archive.presentations.length
    )

  return project
}

/* ---------------- moving the identity to another PC ---------------- */

/**
 * A transfer code.
 *
 * Each installation is its own account in the cloud, which is what keeps two
 * customers' work apart. The cost is that a second PC is a second account and
 * would see an empty cloud. This code is how the identity travels: the address
 * and password that belong to the first PC, encoded so they can be typed or
 * pasted once on the other machine. It is a credential, and the panel that
 * shows it says so.
 */
const KEY_PREFIX = 'indrahub-cloud-1.'

export function exportCloudKey(viewer: SessionUser): { code: string } {
  const current = readIdentity(viewer.id)
  if (!current) throw errors.cloud('Nothing has been saved to the cloud from this PC yet.')
  const payload = JSON.stringify({ v: 1, email: current.email, password: current.password })
  return { code: `${KEY_PREFIX}${Buffer.from(payload, 'utf8').toString('base64url')}` }
}

/**
 * Adopts another PC's cloud identity, after proving the password still works.
 *
 * The local record of which projects were saved is cleared: those rows describe
 * a different account's copies, and a stale badge that opens nothing is worse
 * than no badge.
 */
export async function adoptCloudKey(viewer: SessionUser, raw: string): Promise<CloudState> {
  const code = typeof raw === 'string' ? raw.trim() : ''
  if (!code.startsWith(KEY_PREFIX)) {
    throw errors.validation('That is not a cloud transfer code.', 'code')
  }

  let parsed: { v?: unknown; email?: unknown; password?: unknown }
  try {
    parsed = JSON.parse(Buffer.from(code.slice(KEY_PREFIX.length), 'base64url').toString('utf8'))
  } catch {
    throw errors.validation('That cloud transfer code is damaged.', 'code')
  }
  const email = typeof parsed.email === 'string' ? parsed.email : ''
  const password = typeof parsed.password === 'string' ? parsed.password : ''
  if (parsed.v !== 1 || !/^device-[0-9a-f]{16}@/.test(email) || password.length < 16) {
    throw errors.validation('That is not a cloud transfer code.', 'code')
  }

  assertReachable()

  const adopted = await signInWithPassword({
    email,
    password,
    uid: '',
    accessToken: '',
    refreshToken: '',
    expiresAt: 0
  })
  saveIdentity(viewer.id, adopted)
  clearSetting(`${PROFILE_PREFIX}:${viewer.id}`)
  getDatabase().prepare('DELETE FROM cloud_saves').run()
  // Resolve the profile now, so a broken code fails here rather than on the
  // first save the user tries.
  await profileFor(viewer, adopted)

  return cloudState(viewer)
}

/**
 * Forgets this machine's cloud identity. The copies in the cloud stay — they
 * belong to the account — but this installation can no longer reach them,
 * which is what "sign this PC out of the cloud" has to mean.
 */
export function forgetCloudIdentity(viewer: SessionUser): void {
  clearSetting(`${IDENTITY_PREFIX}:${viewer.id}`)
  clearSetting(`${PROFILE_PREFIX}:${viewer.id}`)
  getDatabase().prepare('DELETE FROM cloud_saves').run()
}
