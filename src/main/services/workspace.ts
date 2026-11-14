import { BrowserWindow } from 'electron'
import type { WorkspaceCredentialsInput, WorkspaceState, WorkspaceTransport } from '@shared/types'
import {
  WORKSPACE_BUCKET,
  WORKSPACE_IMAGE_TYPES,
  WORKSPACE_KEY,
  WORKSPACE_MAX_IMAGE_BYTES,
  WORKSPACE_MAX_VIDEO_BYTES,
  WORKSPACE_ROW_ID,
  WORKSPACE_TABLE,
  WORKSPACE_URL,
  WORKSPACE_VIDEO_TYPES,
  isBuiltInWorkspace,
  normaliseUrl
} from '@shared/workspace'
import { getDatabase } from '../db/database'
import { errors } from '../lib/errors'
import { sealSecret, unsealSecret } from '../lib/seal'
import { adoptBackground, readLoginAppearance, readLoginBackgroundFile, removeLoginBackground, writeTreatment, treatmentPending, clearTreatmentPending
} from './appearance'
import { adminCloudSession } from './cloud'
import {
  adoptDeveloperPhoto,
  clearDeveloperPhotoNeedsClear,
  developerPhotoNeedsClear,
  installedDeveloperPhotoId,
  readAbout,
  readDeveloperPhotoForUpload,
  removeDeveloperPhoto,
  setDeveloperPhotoCloud
} from './about'
import { ensureBackendConfig, readBackendCredentials } from './backend'
import { readSettings, writeSettings } from './settings'

/*
 * The shared workspace.
 *
 * One row in Postgres holds the switches the administrator owns — registration,
 * maintenance, activation keys and the sign-in background — and every
 * installation mirrors it locally. The local database stays the thing the app
 * reads: the sign-in screen, the maintenance screen and the IPC guards never
 * wait for the network, which is what makes a fresh install work offline and
 * then catch up the moment it is online.
 *
 * Two rules keep this honest:
 *   1. The server row is the source of truth. A local edit is published, and
 *      what comes back — from the administrator's own push or from another
 *      machine — is what gets applied.
 *   2. The renderer never holds a token, a URL or a key. All of this lives in
 *      the main process, behind an administrator session for anything that
 *      writes.
 *
 * Transport is a WebSocket subscription when the platform provides one, a
 * short poll when it does not, and a slow reconcile either way. Realtime is a
 * convenience, never a correctness requirement.
 */

const SESSION_KEY = 'workspace_session'
const REVISION_KEY = 'workspace_revision'
const APPLIED_AT_KEY = 'workspace_applied_at'
const HTTP_TIMEOUT_MS = 12_000
const SOCKET_HEARTBEAT_MS = 25_000
const SAFETY_POLL_MS = 60_000
const FALLBACK_POLL_MS = 8_000

interface Session {
  accessToken: string
  refreshToken: string
  expiresAt: number
  email: string
  uid: string
}

/** The view the app reads: no claim hash, and ownership answered per caller. */
interface RemoteWorkspace {
  id: string
  revision: number
  allow_registration: boolean
  maintenance: boolean
  maintenance_message: string
  require_activation_key: boolean
  background_asset_id: string | null
  background_mime: string | null
  background_bytes: number
  background_path: string | null
  background_blur: number
  background_dim: number
  developer_photo_asset_id: string | null
  developer_photo_mime: string | null
  developer_photo_bytes: number
  developer_photo_path: string | null
  developer_photo_name: string | null
  developer_photo_updated_at: string | null
  owned: boolean
  owned_by_me: boolean
  claimable: boolean
}

let session: Session | null = null
let remote: RemoteWorkspace | null = null
let transport: WorkspaceTransport = 'offline'
let lastSyncAt: string | null = null
let lastError: string | null = null
let pending = false
let applying = false
let pushing = false

let socket: WebSocket | null = null
let socketHeartbeat: NodeJS.Timeout | null = null
let reconnectTimer: NodeJS.Timeout | null = null
let pollTimer: NodeJS.Timeout | null = null
let reconcileTimer: NodeJS.Timeout | null = null
let pushTimer: NodeJS.Timeout | null = null
let reconnectAttempt = 0
let started = false

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

function readState(key: string): string | null {
  const row = getDatabase().prepare('SELECT value FROM app_state WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function writeState(key: string, value: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO app_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value)
}

function readSettingValue(key: string): string | null {
  const row = getDatabase().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function writeSettingValue(key: string, value: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, new Date().toISOString())
}

function loadSession(): Session | null {
  const stored = readState(SESSION_KEY)
  if (!stored) return null
  try {
    const { value } = unsealSecret(stored)
    if (!value) return null
    const parsed = JSON.parse(value) as Session
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.uid) return null
    return parsed
  } catch {
    return null
  }
}

function saveSession(next: Session | null): void {
  session = next
  if (!next) {
    getDatabase().prepare('DELETE FROM app_state WHERE key = ?').run(SESSION_KEY)
    return
  }
  writeState(SESSION_KEY, sealSecret(JSON.stringify(next)))
}

/* ------------------------------------------------------------------ */
/* HTTP                                                               */
/* ------------------------------------------------------------------ */

interface RequestOptions {
  method?: string
  body?: unknown
  token?: string | null
  headers?: Record<string, string>
  raw?: Uint8Array | string | null
  expectBinary?: boolean
}

async function call(path: string, options: RequestOptions = {}): Promise<Response> {
  const credentials = readBackendCredentials()
  if (!credentials) throw errors.validation('No workspace is configured on this machine.', 'workspace')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  const headers: Record<string, string> = {
    apikey: credentials.key,
    Authorization: `Bearer ${options.token ?? credentials.key}`,
    ...(options.headers ?? {})
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  try {
    return await fetch(`${credentials.url}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.raw !== undefined ? options.raw : options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The workspace did not answer in time. The app keeps running on this machine.')
    }
    throw new Error('The workspace could not be reached. The app keeps running on this machine.')
  } finally {
    clearTimeout(timer)
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: string; error_description?: string; msg?: string }
    return payload.msg ?? payload.message ?? payload.error_description ?? `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

/* ------------------------------------------------------------------ */
/* Reads and writes                                                    */
/* ------------------------------------------------------------------ */

async function fetchRemote(): Promise<RemoteWorkspace | null> {
  const response = await call(
    `/rest/v1/indra_workspace_state?select=*&id=eq.${WORKSPACE_ROW_ID}`,
    { token: session?.accessToken ?? null }
  )
  if (!response.ok) throw new Error(await readError(response))
  const rows = (await response.json()) as RemoteWorkspace[]
  return rows[0] ?? null
}

async function patchRemote(patch: Record<string, unknown>, revision: number): Promise<RemoteWorkspace | null> {
  const response = await call(
    `/rest/v1/indra_workspace?id=eq.${WORKSPACE_ROW_ID}&revision=eq.${revision}`,
    {
      method: 'PATCH',
      body: patch,
      token: session?.accessToken ?? null,
      headers: { Prefer: 'return=representation' }
    }
  )
  if (response.status === 401 || response.status === 403) {
    throw new Error('This account is not allowed to change the workspace.')
  }
  if (!response.ok) throw new Error(await readError(response))
  const rows = (await response.json()) as RemoteWorkspace[]
  return rows[0] ?? null
}

async function uploadBackground(path: string, bytes: Buffer, mime: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)
  const credentials = readBackendCredentials()
  if (!credentials) throw new Error('No workspace is configured on this machine.')
  try {
    const response = await fetch(`${credentials.url}/storage/v1/object/${WORKSPACE_BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: credentials.key,
        Authorization: `Bearer ${session?.accessToken ?? credentials.key}`,
        'Content-Type': mime,
        'x-upsert': 'true',
        'cache-control': 'max-age=3600'
      },
      body: bytes,
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(`The video could not be uploaded (${await readError(response)}).`)
    }
  } finally {
    clearTimeout(timer)
  }
}

async function downloadBackground(path: string): Promise<Buffer> {
  /*
   * The public object route, not `/object/authenticated/`: a fresh install has
   * no session yet, and the storage policy allows reading this bucket, so this
   * is the one request that works signed out. A video the administrator
   * published has to reach a machine nobody has signed in to.
   */
  const response = await call(`/storage/v1/object/${WORKSPACE_BUCKET}/${path}`)
  if (!response.ok) throw new Error(`The video could not be downloaded (${await readError(response)}).`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > WORKSPACE_MAX_VIDEO_BYTES) throw new Error('The shared video is larger than the app accepts.')
  return buffer
}

async function uploadDeveloperPhoto(path: string, bytes: Buffer, mime: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  const credentials = readBackendCredentials()
  if (!credentials) throw new Error('No workspace is configured on this machine.')
  try {
    const response = await fetch(`${credentials.url}/storage/v1/object/${WORKSPACE_BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: credentials.key,
        Authorization: `Bearer ${session?.accessToken ?? credentials.key}`,
        'Content-Type': mime,
        'x-upsert': 'true',
        'cache-control': 'max-age=3600'
      },
      body: bytes,
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(`The portrait could not be uploaded (${await readError(response)}).`)
    }
  } finally {
    clearTimeout(timer)
  }
}

async function downloadDeveloperPhoto(path: string): Promise<Buffer> {
  const response = await call(`/storage/v1/object/${WORKSPACE_BUCKET}/${path}`)
  if (!response.ok) throw new Error(`The portrait could not be downloaded (${await readError(response)}).`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0) throw new Error('The shared portrait is empty, so it was not installed.')
  if (buffer.length > WORKSPACE_MAX_IMAGE_BYTES) throw new Error('The shared portrait is larger than the app accepts.')
  return buffer
}

async function deleteDeveloperPhoto(path: string): Promise<void> {
  try {
    await call(`/storage/v1/object/${WORKSPACE_BUCKET}/${path}`, {
      method: 'DELETE',
      token: session?.accessToken ?? null
    })
  } catch {
    // A leftover object is harmless; the row no longer points at it.
  }
}

async function deleteBackground(path: string): Promise<void> {
  try {
    await call(`/storage/v1/object/${WORKSPACE_BUCKET}/${path}`, {
      method: 'DELETE',
      token: session?.accessToken ?? null
    })
  } catch {
    // A leftover object is harmless; the row no longer points at it.
  }
}

/* ------------------------------------------------------------------ */
/* Applying what the cloud says                                        */
/* ------------------------------------------------------------------ */

function extensionFor(mime: string): string {
  if (mime === 'image/png') return '.png'
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/webp') return '.webp'
  if (mime === 'video/webm') return '.webm'
  if (mime === 'video/x-m4v') return '.m4v'
  if (mime === 'video/ogg') return '.ogv'
  return '.mp4'
}

/**
 * Brings this installation's portrait in line with the shared row.
 *
 * Three outcomes matter. The row names a portrait this machine does not have →
 * download and adopt. The row names no portrait but this machine shows one that
 * it published → drop it here too. The ids already agree → nothing happens,
 * which is the common case on every poll after the first.
 */
async function applyRemoteDeveloperPhoto(next: RemoteWorkspace): Promise<string | null> {
  const local = readAbout().developer
  const assetId = next.developer_photo_asset_id
  const mime = String(next.developer_photo_mime ?? '')

  if (developerPhotoNeedsClear()) {
    /*
     * A removal this machine has not published yet. While it *can* publish —
     * the signed-in account owns the row — adopting the row now would put the
     * old face back, so the mirror waits. A machine that cannot publish (not
     * signed in, or signed in as somebody else) must not end up ignoring the
     * shared portrait for ever, so there the owner's row wins and the panel is
     * told why the photo came back.
     */
    if (next.owned_by_me) return null
    clearDeveloperPhotoNeedsClear()
    return 'That portrait is shared, and this PC is not the account that owns the workspace, so the shared copy was restored.'
  }

  if (!assetId) {
    if (local.stored && local.cloud) {
      removeDeveloperPhoto()
      broadcastAboutChange()
    }
    return null
  }
  if (local.stored) {
    const current = readDeveloperPhotoForUpload()
    if (current?.id === assetId) {
      // Already the published portrait. Re-reading it also repairs a row whose
      // file went missing, because readDeveloperPhotoForUpload returns null then
      // and the download below runs instead.
      setDeveloperPhotoCloud(true)
      return null
    }
  }

  if (!WORKSPACE_IMAGE_TYPES.includes(mime) || !next.developer_photo_path) {
    return 'The shared workspace describes a portrait the app cannot display, so it was not installed.'
  }
  const bytes = await downloadDeveloperPhoto(String(next.developer_photo_path))
  adoptDeveloperPhoto({
    id: assetId,
    bytes,
    mime,
    originalName: next.developer_photo_name,
    createdAt: next.developer_photo_updated_at
  })
  setDeveloperPhotoCloud(true)
  broadcastAboutChange()
  return null
}

/**
 * Writes a remote row into the local mirror. Every field is treated as
 * untrusted: the database constraints upstream should already have refused
 * nonsense, and this refuses it again rather than trusting the wire.
 */
export async function applyRemote(next: RemoteWorkspace): Promise<string | null> {
  applying = true
  let warning: string | null = null
  try {
    const message = String(next.maintenance_message ?? '').trim().slice(0, 400)
    writeSettings({
      allowRegistration: Boolean(next.allow_registration),
      maintenanceMode: Boolean(next.maintenance),
      maintenanceMessage: message || 'INDRA HUB is temporarily unavailable while maintenance is carried out.',
      requireActivationKey: Boolean(next.require_activation_key)
    })

    /*
     * A slider moved a second ago is not the server's to overwrite.
     *
     * The rows below arrive from the shared workspace, and applying them while
     * a change of our own is still waiting to be published is how a treatment
     * the administrator just set snaps back to whatever the server last heard:
     * they drag it, look away, and it is 18/46 again. While something is
     * pending, the local value is the newer one.
     */
    if (!pending && !treatmentPending()) {
      const blur = Math.min(40, Math.max(0, Math.round(Number(next.background_blur) || 0)))
      const dim = Math.min(92, Math.max(0, Math.round(Number(next.background_dim) || 0)))
      writeTreatment({ blur, dim })
    }

    const local = readLoginAppearance().background
    const assetId = next.background_asset_id
    const mime = String(next.background_mime ?? '')

    /*
     * The switches above are already applied, and they are the part that must
     * never be blocked by a video. A background that cannot be fetched or
     * played leaves the previous one on screen and says why.
     */
    try {
      if (!assetId) {
        /*
         * A shared row with no video erases the one on screen — but only when
         * this machine is allowed to write that row. When the workspace belongs
         * to another account, the admin could install a video, watch it vanish
         * on the next reconcile, and have nothing to explain it: the push was
         * silently skipped because this account owns nothing. Keep the local
         * file in that case; it is the only copy that exists.
         */
        if (local && next.owned_by_me) removeLoginBackground()
      } else if (local?.id !== assetId) {
        if (!WORKSPACE_VIDEO_TYPES.includes(mime) || !next.background_path) {
          throw new Error('The shared workspace describes a video the app cannot play, so it was not installed.')
        }
        const bytes = await downloadBackground(String(next.background_path))
        adoptBackground({ id: assetId, bytes, mime, originalName: next.background_path.split('/').pop() })
      }
    } catch (error) {
      warning = messageOf(error)
    }

    /*
     * The portrait follows the same rule as the video, and must not be able to
     * take the switches down with it: a photo that fails to arrive leaves the
     * previous face on screen and reports why.
     */
    try {
      const photoWarning = await applyRemoteDeveloperPhoto(next)
      if (photoWarning) warning = warning ?? photoWarning
    } catch (error) {
      warning = warning ?? messageOf(error)
    }

    writeSettingValue(REVISION_KEY, String(next.revision))
    writeSettingValue(APPLIED_AT_KEY, new Date().toISOString())
    remote = next
  } finally {
    applying = false
  }

  return warning
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export function workspaceState(): WorkspaceState {
  const credentials = readBackendCredentials()
  const appliedRevision = Number(readSettingValue(REVISION_KEY) ?? '') || null

  return {
    configured: Boolean(credentials),
    builtIn: Boolean(credentials) && isBuiltInWorkspace(credentials?.url, credentials?.key),
    url: credentials?.url ?? null,
    signedIn: Boolean(session),
    email: session?.email ?? null,
    owner: Boolean(remote?.owned_by_me),
    claimable: Boolean(remote?.claimable),
    revision: remote?.revision ?? null,
    appliedRevision,
    lastSyncAt,
    lastError,
    transport,
    pending
  }
}

export function broadcastWorkspaceChange(): void {
  const state = workspaceState()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('workspace:changed', state)
  }
}

/**
 * Tells every open window that the portrait changed — whether this machine set
 * it, another machine published it, or a reconcile repaired a missing file.
 * Without this the About card keeps showing the face it loaded at mount, which
 * is exactly the bug the user would report as "it does not sync".
 */
export function broadcastAboutChange(): void {
  const info = readAbout()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('about:changed', info)
  }
}

/* ------------------------------------------------------------------ */
/* Reconcile                                                           */
/* ------------------------------------------------------------------ */

/*
 * Reconciles are serialised rather than dropped. A poll, a socket event and a
 * manual "Sync now" can arrive at the same moment, and the second one must run
 * against the row the first one fetched — not be discarded, which would leave
 * the machine a revision behind until the next trigger.
 */
let reconcileChain: Promise<unknown> = Promise.resolve()

async function tick(): Promise<void> {
  /*
   * A local change that has not reached the row yet must be published before
   * an incoming row is applied, or the next poll would silently flatten what
   * the administrator just did. This is also the retry path for a push that
   * failed while the network was away.
   */
  if (pending && session && !pushing && !applying) await push()
  await reconcileOnce()
}

export function reconcile(): Promise<WorkspaceState> {
  reconcileChain = reconcileChain.then(tick, tick)
  return reconcileChain.then(() => workspaceState())
}

async function reconcileOnce(): Promise<void> {
  if (!readBackendCredentials()) return

  try {
    if (session && session.expiresAt - 60_000 < Date.now()) await refreshSession()
    const next = await fetchRemote()
    if (!next) {
      lastError = 'The workspace row is missing. Run supabase/workspace.sql in the project.'
      transport = 'offline'
      return
    }

    /*
     * An unclaimed row has no owner, and only an owner can ever write it — so
     * everything in it is still the value the project shipped with. Applying
     * it would quietly undo whatever this machine's administrator has just
     * configured (the first sign-in video upload after 1.6.0 disappeared this
     * way). Until it is claimed, this machine is the authority; the moment it
     * is claimed, the new owner publishes what it already had.
     */
    if (!next.owned) {
      remote = next
      lastError = null
      lastSyncAt = new Date().toISOString()
      if (transport === 'offline') transport = socket ? 'live' : 'polling'
      return
    }

    const sameRevision = String(next.revision) === (readSettingValue(REVISION_KEY) ?? '')
    const sameAsset = (next.background_asset_id ?? null) === (readLoginAppearance().background?.id ?? null)
    /*
     * The portrait is checked on its own, not only when the revision moves: a
     * file deleted from this disk (a cleanup tool, a half-finished copy) is not
     * a row change, and waiting for one would leave the About card showing the
     * fallback mark indefinitely. installedDeveloperPhotoId() is a stat, so this
     * costs nothing on the polls where nothing is wrong.
     */
    const samePortrait =
      !next.developer_photo_asset_id ||
      next.developer_photo_asset_id === installedDeveloperPhotoId() ||
      developerPhotoNeedsClear()
    let warning: string | null = null
    if (!sameRevision || !sameAsset || !samePortrait) warning = await applyRemote(next)
    else remote = next

    lastError = warning
    lastSyncAt = new Date().toISOString()
    if (transport === 'offline') transport = socket ? 'live' : 'polling'
  } catch (error) {
    lastError = messageOf(error)
    if (!socket) transport = 'offline'
  } finally {
    broadcastWorkspaceChange()
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The workspace could not be reached.'
}

/* ------------------------------------------------------------------ */
/* Publishing local changes                                            */
/* ------------------------------------------------------------------ */

/** Called after any administrator change that the workspace should inherit. */
export function queuePush(): void {
  if (applying) return
  // Nothing to publish without an account. Ownership is re-checked in push(),
  // so a change made in the first seconds after launch still gets out.
  if (!session) return
  pending = true
  broadcastWorkspaceChange()
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    void push()
  }, 600)
}

export async function push(): Promise<WorkspaceState> {
  if (!pending || pushing) return workspaceState()
  if (!session) {
    pending = false
    return workspaceState()
  }

  pushing = true
  try {
    if (session.expiresAt - 60_000 < Date.now()) await refreshSession()
    if (!remote) remote = await fetchRemote()
    if (!remote?.owned_by_me) {
      // Signed in, but not the account that owns the row: this machine keeps
      // its own copy and publishes nothing.
      pending = false
      broadcastWorkspaceChange()
      return workspaceState()
    }

    const settings = readSettings()
    const appearance = readLoginAppearance()
    const background = appearance.background
    const current = await fetchRemote()
    if (!current) throw new Error('The workspace row is missing.')

    const patch: Record<string, unknown> = {
      allow_registration: settings.allowRegistration,
      maintenance: settings.maintenanceMode,
      maintenance_message: settings.maintenanceMessage,
      require_activation_key: settings.requireActivationKey,
      background_blur: appearance.blur,
      background_dim: appearance.dim
    }

    /*
     * The portrait publishes on the same push as everything else. A machine
     * that never set one, and is not the one that published the current row's,
     * leaves those columns exactly as they are: pushing nulls from a second
     * installation would erase the administrator's photo everywhere.
     */
    const portrait = readAbout().developer
    const portraitId = installedDeveloperPhotoId()
    /*
     * The bytes are only read when the row does not already describe this
     * portrait. A push happens on every administrative change, and reading an
     * 8 MB image to discover there is nothing to upload would be waste on a
     * path that has nothing to do with the portrait.
     */
    const publishPortrait =
      Boolean(portraitId) && (portraitId !== current.developer_photo_asset_id || !portrait.cloud)
    const photo = publishPortrait ? readDeveloperPhotoForUpload() : null
    let uploadedPhotoPath: string | null = null
    if (photo) {
      if (!WORKSPACE_IMAGE_TYPES.includes(photo.mime)) {
        throw new Error('That portrait type cannot be shared with other PCs.')
      }
      if (photo.bytes.length > WORKSPACE_MAX_IMAGE_BYTES) {
        throw new Error('That portrait is too large to share.')
      }
      const path = `avatar/${photo.id}${extensionFor(photo.mime)}`
      await uploadDeveloperPhoto(path, photo.bytes, photo.mime)
      uploadedPhotoPath = path
      patch.developer_photo_asset_id = photo.id
      patch.developer_photo_mime = photo.mime
      patch.developer_photo_bytes = photo.bytes.length
      patch.developer_photo_path = path
      patch.developer_photo_name = photo.originalName
      patch.developer_photo_updated_at = new Date().toISOString()
    }

    /*
     * The clear is only forgotten once the row has actually accepted it. Doing
     * it here — before the patch — meant an offline or losing push dropped the
     * removal for good, and the next reconcile brought the old face back.
     */
    const clearingPhoto = developerPhotoNeedsClear()
    if (clearingPhoto) {
      patch.developer_photo_asset_id = null
      patch.developer_photo_mime = null
      patch.developer_photo_bytes = 0
      patch.developer_photo_path = null
      patch.developer_photo_name = null
      patch.developer_photo_updated_at = new Date().toISOString()
    }

    if (!background) {
      patch.background_asset_id = null
      patch.background_mime = null
      patch.background_bytes = 0
      patch.background_path = null
    } else if (background.id !== current.background_asset_id) {
      const file = readLoginBackgroundFile()
      if (!file) throw new Error('The installed video could not be read back for upload.')
      if (file.bytes.length > WORKSPACE_MAX_VIDEO_BYTES) throw new Error('That video is too large to share.')
      const path = `background/${background.id}${extensionFor(file.mime)}`
      await uploadBackground(path, file.bytes, file.mime)
      patch.background_asset_id = background.id
      patch.background_mime = file.mime
      patch.background_bytes = file.bytes.length
      patch.background_path = path
    }

    const updated = await patchRemote(patch, current.revision)
    if (!updated) {
      // Someone else wrote first. Their row wins; this machine adopts it, and
      // the panel keeps the explanation even though the reconcile below is a
      // success. The object this push had already uploaded is nobody's now, so
      // it is removed rather than left to rot in the bucket.
      if (uploadedPhotoPath) await deleteDeveloperPhoto(uploadedPhotoPath)
      pending = false
      // Direct, not through the reconcile chain: push can itself be called
      // from that chain, and awaiting it there would deadlock.
      await reconcileOnce()
      lastError = 'Another machine changed the workspace first, so this change was not applied. The shared version is on screen now.'
      broadcastWorkspaceChange()
      return workspaceState()
    }

    if (clearingPhoto) clearDeveloperPhotoNeedsClear()
    /* The row has our treatment now, so it may speak for it again. */
    clearTreatmentPending()

    // The old object is no longer referenced by the row.
    if (background && current.background_path && current.background_asset_id !== background.id) {
      await deleteBackground(current.background_path)
    }
    if (
      photo &&
      current.developer_photo_path &&
      current.developer_photo_asset_id !== photo.id
    ) {
      await deleteDeveloperPhoto(current.developer_photo_path)
    }
    if (clearingPhoto && current.developer_photo_path) {
      await deleteDeveloperPhoto(current.developer_photo_path)
    }

    remote = updated
    writeSettingValue(REVISION_KEY, String(updated.revision))
    writeSettingValue(APPLIED_AT_KEY, new Date().toISOString())
    lastError = null
    lastSyncAt = new Date().toISOString()
    if (background) lastError = (await applyRemote(updated)) ?? null
    if (photo) {
      setDeveloperPhotoCloud(true)
      broadcastAboutChange()
    }
    pending = false
    broadcastWorkspaceChange()
  } catch (error) {
    lastError = messageOf(error)
    broadcastWorkspaceChange()
  } finally {
    pushing = false
  }

  return workspaceState()
}

/** Forgets a local change that could not be published, then reloads the truth. */
export async function discardPending(): Promise<WorkspaceState> {
  pending = false
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  return reconcile()
}

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

function validEmail(value: string): string {
  const email = String(value ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw errors.validation('Enter the email address for the workspace owner.', 'email')
  }
  return email
}

function validPassword(value: string): string {
  const password = String(value ?? '')
  if (password.length < 8) {
    throw errors.validation('Use at least 8 characters for the workspace password.', 'password')
  }
  return password
}

interface AuthPayload {
  access_token: string
  refresh_token: string
  expires_in?: number
  expires_at?: number
  user?: { id?: string; email?: string }
}

function toSession(payload: AuthPayload, fallbackEmail: string): Session {
  const expiresAt = payload.expires_at
    ? payload.expires_at * 1000
    : Date.now() + (payload.expires_in ?? 3600) * 1000
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt,
    email: payload.user?.email ?? fallbackEmail,
    uid: payload.user?.id ?? ''
  }
}

async function authRequest(path: string, body: unknown): Promise<AuthPayload> {
  const response = await call(path, { method: 'POST', body })
  if (!response.ok) {
    const message = await readError(response)
    if (/invalid login credentials/i.test(message)) {
      throw errors.validation('That email and password do not match a workspace account.', 'password')
    }
    if (/already registered|already exists/i.test(message)) {
      throw errors.validation('That email already has a workspace account. Sign in instead.', 'email')
    }
    if (/email not confirmed/i.test(message)) {
      throw errors.validation(
        'The workspace project still asks for email confirmation. Turn on auto-confirm in Supabase Auth settings.',
        'email'
      )
    }
    throw new Error(message)
  }
  return (await response.json()) as AuthPayload
}

export async function signInWorkspace(input: WorkspaceCredentialsInput): Promise<WorkspaceState> {
  const email = validEmail(input?.email)
  const password = String(input?.password ?? '')
  if (!password) throw errors.validation('Enter the workspace password.', 'password')

  const payload = await authRequest('/auth/v1/token?grant_type=password', { email, password })
  saveSession(toSession(payload, email))
  lastError = null
  /*
   * The account is the owner now, so the machine that claimed is the machine
   * that decides: what it has been running on becomes the workspace's
   * configuration. Clearing `remote` forces the push to read the row as it is
   * after the claim (a new revision), and leaving `pending` set means a failed
   * push is retried by the next reconcile instead of being forgotten.
   */
  remote = null
  pending = true
  await push()
  broadcastWorkspaceChange()
  return workspaceState()
}

/**
 * The way out of a workspace that can never be claimed.
 *
 * A claim normally needs the one-time setup code, whose SHA-256 was seeded into
 * the row. The code itself exists nowhere else — not in the app, not in the
 * database — so an administrator who loses it can otherwise never publish a
 * setting or a video again, and every change quietly stays on one PC.
 *
 * This path asks a different authority: the server administrator, the identity
 * `indra_claim_admin()` already trusts. It appoints the account this machine is
 * signed in to as the workspace's owner. The server re-checks the role, refuses
 * if the row already has an owner, and refuses a uid with no cloud profile.
 *
 * The local administrator never touches the workspace here; the account whose
 * session is on screen becomes its owner, and this machine publishes what it is
 * already running — exactly as claiming with the code does.
 */
export async function claimWorkspaceAsAdmin(adminId: string): Promise<WorkspaceState> {
  if (!session) throw errors.validation('Sign in to the workspace account first.', 'code')

  const admin = await adminCloudSession(adminId)
  const response = await call('/rest/v1/rpc/indra_claim_workspace_as_admin', {
    method: 'POST',
    body: { p_owner: session.uid },
    token: admin.token
  })
  if (!response.ok) throw new Error(await readError(response))

  const result = (await response.json()) as { claimed: boolean; reason: string | null }
  if (!result.claimed) {
    throw new Error(result.reason ?? 'The workspace already has an owner.')
  }

  remote = null
  pending = true
  await push()
  broadcastWorkspaceChange()
  return workspaceState()
}

export async function signUpWorkspace(input: WorkspaceCredentialsInput): Promise<WorkspaceState> {
  const email = validEmail(input?.email)
  const password = validPassword(input?.password)

  const payload = await authRequest('/auth/v1/signup', { email, password })
  if (!payload.access_token) {
    throw errors.validation(
      'The account was created but is not signed in yet: the project asks for email confirmation. Turn on auto-confirm in Supabase Auth settings.',
      'email'
    )
  }
  saveSession(toSession(payload, email))
  lastError = null
  await reconcile()
  broadcastWorkspaceChange()
  return workspaceState()
}

async function refreshSession(): Promise<void> {
  if (!session?.refreshToken) throw new Error('Sign in to the workspace again.')
  const payload = await authRequest('/auth/v1/token?grant_type=refresh_token', {
    refresh_token: session.refreshToken
  })
  saveSession(toSession(payload, session.email))
}

export function signOutWorkspace(): WorkspaceState {
  saveSession(null)
  remote = null
  lastError = null
  broadcastWorkspaceChange()
  return workspaceState()
}

export async function claimWorkspace(code: string): Promise<WorkspaceState> {
  if (!session) throw errors.validation('Sign in to the workspace account first.', 'code')
  const value = String(code ?? '').trim()
  if (value.length < 8) throw errors.validation('Enter the setup code for this workspace.', 'code')

  const response = await call('/rest/v1/rpc/indra_claim_workspace', {
    method: 'POST',
    body: { p_code: value },
    token: session.accessToken
  })
  if (!response.ok) throw new Error(await readError(response))
  const claimed = (await response.json()) as boolean
  if (!claimed) {
    throw errors.validation(
      'That setup code was not accepted, or the workspace is already claimed by another account.',
      'code'
    )
  }

  /*
   * The account is the owner now, so the machine that claimed is the machine
   * that decides: what it has been running on becomes the workspace's
   * configuration. Clearing `remote` forces the push to read the row as it is
   * after the claim (a new revision), and leaving `pending` set means a failed
   * push is retried by the next reconcile instead of being forgotten.
   */
  remote = null
  pending = true
  await push()
  broadcastWorkspaceChange()
  return workspaceState()
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

function scheduleReconcile(delay = 250): void {
  if (reconcileTimer) clearTimeout(reconcileTimer)
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null
    void reconcile()
  }, delay)
}

function socketUrl(url: string, key: string): string {
  const base = normaliseUrl(url).replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
  return `${base}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`
}

function connectRealtime(): void {
  const credentials = readBackendCredentials()
  const Socket = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket
  if (!credentials || !Socket) {
    transport = credentials ? 'polling' : 'offline'
    broadcastWorkspaceChange()
    return
  }

  closeRealtime()

  try {
    const socketInstance = new Socket(socketUrl(credentials.url, credentials.key))
    socket = socketInstance

    socketInstance.addEventListener('open', () => {
      reconnectAttempt = 0
      transport = 'live'
      socketInstance.send(
        JSON.stringify({
          topic: `realtime:public:${WORKSPACE_TABLE}`,
          event: 'phx_join',
          payload: {
            config: {
              postgres_changes: [
                { event: '*', schema: 'public', table: WORKSPACE_TABLE, filter: `id=eq.${WORKSPACE_ROW_ID}` }
              ]
            }
          },
          ref: '1',
          join_ref: '1'
        })
      )
      socketHeartbeat = setInterval(() => {
        try {
          socketInstance.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: '2' }))
        } catch {
          // The close handler will notice and reconnect.
        }
      }, SOCKET_HEARTBEAT_MS)
      scheduleReconcile(0)
      broadcastWorkspaceChange()
    })

    socketInstance.addEventListener('message', (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(event.data)) as { event?: string; payload?: unknown }
        if (parsed.event === 'postgres_changes') scheduleReconcile(150)
      } catch {
        // Realtime is not a trusted input parser; ignore anything unreadable.
      }
    })

    socketInstance.addEventListener('close', () => {
      if (socketHeartbeat) clearInterval(socketHeartbeat)
      socketHeartbeat = null
      socket = null
      transport = 'polling'
      broadcastWorkspaceChange()
      scheduleReconnect()
    })

    socketInstance.addEventListener('error', () => {
      transport = 'polling'
      broadcastWorkspaceChange()
    })
  } catch {
    socket = null
    transport = 'polling'
    broadcastWorkspaceChange()
  }

  ensurePolling()
}

function scheduleReconnect(): void {
  if (!started) return
  if (reconnectTimer) clearTimeout(reconnectTimer)
  const delay = Math.min(60_000, 2_000 * Math.pow(2, Math.min(reconnectAttempt, 5)))
  reconnectAttempt += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connectRealtime()
  }, delay)
}

function closeRealtime(): void {
  if (socketHeartbeat) clearInterval(socketHeartbeat)
  socketHeartbeat = null
  if (socket) {
    try {
      socket.close()
    } catch {
      // Already closed.
    }
    socket = null
  }
}

function ensurePolling(): void {
  if (pollTimer) clearInterval(pollTimer)
  const interval = transport === 'live' ? SAFETY_POLL_MS : FALLBACK_POLL_MS
  pollTimer = setInterval(() => {
    if (transport === 'live') return void reconcile()
    if (!socket) connectRealtime()
    void reconcile()
  }, interval)
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

/**
 * Puts the compiled-in endpoint in place when nothing has been configured.
 *
 * An installation that deliberately disconnected (`workspace_opt_out`) is left
 * alone: re-adding the endpoint on the next launch would make disconnecting
 * impossible, which is exactly the kind of loop hole this app should not have.
 */
export function ensureBuiltInWorkspace(): { seeded: boolean } {
  if (readSettingValue('workspace_opt_out') === 'true') return { seeded: false }
  return ensureBackendConfig(WORKSPACE_URL, WORKSPACE_KEY)
}

/** Remembers that this machine was deliberately detached from the workspace. */
export function markWorkspaceOptOut(optedOut: boolean): void {
  writeSettingValue('workspace_opt_out', String(optedOut))
}

export function startWorkspaceSync(): void {
  if (started) return
  started = true
  session = loadSession()
  if (!readBackendCredentials()) {
    transport = 'offline'
    return
  }
  void reconcile()
  connectRealtime()
}

export function stopWorkspaceSync(): void {
  started = false
  closeRealtime()
  if (pollTimer) clearInterval(pollTimer)
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (reconcileTimer) clearTimeout(reconcileTimer)
  if (pushTimer) clearTimeout(pushTimer)
  pollTimer = null
  reconnectTimer = null
  reconcileTimer = null
  pushTimer = null
}

/** True when a local administrator change should also be published. */
export function shouldPublish(): boolean {
  return Boolean(session && remote?.owned_by_me)
}
