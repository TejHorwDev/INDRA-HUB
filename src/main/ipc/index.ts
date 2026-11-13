import { BrowserWindow, dialog, ipcMain } from 'electron'
import { basename } from 'node:path'
import type {
  ChangePasswordInput,
  CreateProjectInput,
  DeleteAccountInput,
  LoginInput,
  ProfileInput,
  RegisterInput,
  SessionUser,
  WorkspaceClaimInput,
  WorkspaceCredentialsInput
} from '@shared/types'
import { toResult } from '../lib/errors'
import { archiveProject, exportProjectToFile, importProjectFromFile, restoreArchive } from '../services/archive'
import { recheckConnectivity } from '../services/connectivity'
import { librarySnapshot } from '../services/library'
import { validateSearchQuery } from '../lib/validation'
import {
  changeOwnPassword,
  currentUser,
  deleteOwnAccount,
  register,
  requireUser,
  signIn,
  signOut,
  updateProfile
} from '../services/auth'
import {
  addMember,
  assertCanManageTeam,
  createProject,
  getProject,
  listProjects,
  removeMember
} from '../services/projects'
import { searchUsers } from '../services/users'
import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  listVersions,
  renameDocument,
  restoreVersion,
  saveDocument
} from '../services/documents'
import {
  convertDocument,
  createBlankPresentation,
  deletePresentation,
  duplicatePresentation,
  getPresentation,
  listPresentations,
  savePresentation
} from '../services/presentations'
import { projectGraph } from '../services/graph'
import {
  adminOverview,
  adminSignIn,
  adminSignOut,
  adminStatus,
  changeAdminPassword,
  createKeys,
  deleteAccount,
  deleteDocument as deleteDocumentAsAdmin,
  deletePresentation as deletePresentationAsAdmin,
  deleteProject,
  removeKey,
  renameProject,
  resetAccountPassword,
  revokeKey,
  setAccountSuspended,
  setupAdmin,
  signInAdminFromLogin,
  signOutAccount,
  signOutAllAccounts,
  transferProject,
  clearAppearanceVideo,
  installAppearanceVideo,
  requireAdmin,
  updateAdminIdentity,
  updateAppearanceTreatment,
  updateSettings
} from '../services/admin'
import { publicStatus } from '../services/settings'
import {
  claimWorkspace,
  discardPending,
  markWorkspaceOptOut,
  push,
  queuePush,
  workspaceState,
  reconcile,
  signInWorkspace,
  signOutWorkspace,
  signUpWorkspace
} from '../services/workspace'
import {
  backgroundHealth,
  publicAppearance,
  readLoginBackgroundFile
} from '../services/appearance'
import { checkForUpdates, diagnoseConnection, installUpdate, updateState } from '../services/updates'
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  removeTeamMember,
  renameTeam,
  searchTeamCandidates,
  teamOverview
} from '../services/teams'
import {
  backendStatus,
  clearBackendConfig,
  saveBackendConfig,
  testBackendConnection
} from '../services/backend'
import type {
  AdminIdentityInput,
  AdminLoginInput,
  AdminSettings,
  AdminSetupInput,
  AppearanceTreatment,
  LoginAppearance,
  BackendConfigInput
} from '@shared/types'

/** Every project call resolves the caller here, never from the renderer. */
function actor(): SessionUser {
  return requireUser()
}

function requireProjectId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    throw new Error('invalid project id')
  }
  return value
}

function requireUserId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    throw new Error('invalid user id')
  }
  return value
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`invalid ${field}`)
  return value
}

function requireRecordId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    throw new Error('invalid record id')
  }
  return value
}

export function registerIpcHandlers(): void {
  /* ---------------- public app status ---------------- */
  // Signed-out screens need these two switches to render honestly.
  ipcMain.handle('app:status', () => toResult(() => publicStatus()))

  /*
   * Connectivity is public too: the shell asks before anyone has signed in,
   * because a machine with no route out should not be told to check for
   * updates, and the sign-in screen should say so plainly.
   */
  ipcMain.handle('app:connectivity', () => toResult(() => recheckConnectivity()))

  /* ---------------- offline library ---------------- */
  // Every document and deck the account can reach, in one read.
  ipcMain.handle('library:snapshot', () => toResult(() => librarySnapshot(actor())))

  /*
   * What the signed-out screens look like. Public by design — the sign-in
   * screen has to draw itself before anyone has identified themselves — but it
   * carries a flag, a mime type and two numbers, never a file name or a path.
   */
  ipcMain.handle('app:appearance', () => toResult(() => publicAppearance()))

  /*
   * The bytes themselves, played from a Blob URL in the renderer. Also public:
   * the sign-in screen needs them before anyone has signed in.
   */
  ipcMain.handle('app:appearance:video', () =>
    toResult(() => {
      const file = readLoginBackgroundFile()
      if (!file) return null
      return { bytes: file.bytes, mime: file.mime }
    })
  )

  /* ---------------- optional Supabase connection ---------------- */
  // Machine-level configuration: an administrator decision, not a user one.
  // The panel only exists behind the admin gate, and the main process refuses
  // these calls outright without an admin session — hiding a tab is not a lock.
  ipcMain.handle('backend:status', () =>
    toResult(() => {
      requireAdmin()
      return backendStatus()
    })
  )

  ipcMain.handle('backend:test', () =>
    toResult(() => {
      requireAdmin()
      return testBackendConnection()
    })
  )

  ipcMain.handle('backend:save', (_event, input: BackendConfigInput) =>
    toResult(() => {
      requireAdmin()
      // A deliberate endpoint is also an opt-in: the built-in one is no longer
      // forced on this machine.
      markWorkspaceOptOut(false)
      return saveBackendConfig(input ?? { url: '', key: '' })
    })
  )

  ipcMain.handle('backend:clear', () =>
    toResult(() => {
      requireAdmin()
      const next = clearBackendConfig()
      // Without this the compiled-in endpoint would be put back on the next
      // launch, and "disconnect" would be a button that does nothing.
      markWorkspaceOptOut(true)
      return next
    })
  )

  /* ---------------- self-update ---------------- */
  // Readable by any renderer: the state is only a version number and progress.
  ipcMain.handle('updates:state', () => toResult(() => updateState()))
  ipcMain.handle('updates:check', () => toResult(() => checkForUpdates(true)))
  ipcMain.handle('updates:install', () => toResult(() => installUpdate()))
  // Proves the path works rather than only explaining a failure.
  ipcMain.handle('updates:diagnose', () => toResult(() => diagnoseConnection()))

  /* ---------------- accounts ---------------- */
  ipcMain.handle('auth:register', (_event, input: RegisterInput) =>
    toResult(() => register(input ?? ({} as RegisterInput)))
  )

  ipcMain.handle('auth:login', (_event, input: LoginInput) =>
    toResult(() => signIn(input ?? ({} as LoginInput)))
  )

  // The same screen signs the administrator in; the answer is null for anyone
  // who is not the administrator, so nothing about them is revealed.
  ipcMain.handle(
    'auth:admin-login',
    (_event, input: { identifier?: string; password?: string }) =>
      toResult(() => signInAdminFromLogin(input ?? {}))
  )

  ipcMain.handle('auth:logout', () =>
    toResult(() => {
      signOut()
      return null
    })
  )

  ipcMain.handle('auth:session', () => toResult(() => currentUser()))

  ipcMain.handle('auth:update-profile', (_event, input: ProfileInput) =>
    toResult(() => updateProfile(actor(), input ?? ({ displayName: '', email: '' } as ProfileInput)))
  )

  ipcMain.handle('auth:change-password', (_event, input: ChangePasswordInput) =>
    toResult(() => {
      changeOwnPassword(
        actor(),
        input ?? ({ currentPassword: '', newPassword: '' } as ChangePasswordInput)
      )
      return null
    })
  )

  ipcMain.handle('auth:delete-account', (_event, input: DeleteAccountInput) =>
    toResult(() => {
      deleteOwnAccount(actor(), input ?? ({ password: '' } as DeleteAccountInput))
      return null
    })
  )

  /* ---------------- projects ---------------- */
  /* ---------------- teams ---------------- */
  /*
   * Every call resolves the caller in the main process. Ownership is checked
   * inside the service, so a member of somebody else's team can read the
   * roster and cannot change it.
   */
  ipcMain.handle('team:read', () => toResult(() => teamOverview(actor())))

  ipcMain.handle('team:create', (_event, input: { name?: string } | undefined) =>
    toResult(() => createTeam(actor(), input))
  )

  ipcMain.handle('team:rename', (_event, input: { name?: string } | undefined) =>
    toResult(() => renameTeam(actor(), input ?? {}))
  )

  ipcMain.handle('team:delete', () => toResult(() => deleteTeam(actor())))

  ipcMain.handle('team:add-member', (_event, userId: unknown) =>
    toResult(() => addTeamMember(actor(), userId))
  )

  ipcMain.handle('team:remove-member', (_event, userId: unknown) =>
    toResult(() => removeTeamMember(actor(), userId))
  )

  ipcMain.handle('team:search', (_event, query: unknown) =>
    toResult(() => searchTeamCandidates(actor(), query))
  )

  ipcMain.handle('projects:list', () => toResult(() => listProjects(actor())))

  ipcMain.handle('projects:create', (_event, input: CreateProjectInput) =>
    toResult(() => createProject(actor(), input ?? ({} as CreateProjectInput)))
  )

  ipcMain.handle('projects:get', (_event, projectId: unknown) =>
    toResult(() => getProject(actor(), requireProjectId(projectId)))
  )

  /* ---------------- a copy on this PC ---------------- */
  ipcMain.handle('projects:export', (event, projectId: unknown) =>
    toResult(() =>
      exportProjectToFile(
        actor(),
        requireProjectId(projectId),
        BrowserWindow.fromWebContents(event.sender)
      )
    )
  )

  ipcMain.handle('projects:import', (event) =>
    toResult(() => importProjectFromFile(actor(), BrowserWindow.fromWebContents(event.sender)))
  )

  /*
   * The same restore, for a file handed over some other way (a shared folder,
   * a USB stick on a machine with no dialog). The renderer only ever passes
   * the file's text; the main process parses and validates it.
   */
  ipcMain.handle('projects:restore', (_event, raw: unknown) =>
    toResult(() => {
      if (typeof raw !== 'string' || raw.length === 0) {
        throw new Error('invalid archive')
      }
      return restoreArchive(actor(), raw)
    })
  )

  ipcMain.handle('projects:archive', (_event, projectId: unknown) =>
    toResult(() => archiveProject(actor(), requireProjectId(projectId)))
  )

  ipcMain.handle(
    'projects:add-member',
    (_event, payload: { projectId?: unknown; userId?: unknown }) =>
      toResult(() =>
        addMember(actor(), requireProjectId(payload?.projectId), requireUserId(payload?.userId))
      )
  )

  ipcMain.handle(
    'projects:remove-member',
    (_event, payload: { projectId?: unknown; userId?: unknown }) =>
      toResult(() =>
        removeMember(actor(), requireProjectId(payload?.projectId), requireUserId(payload?.userId))
      )
  )

  /* ---------------- documents ---------------- */
  ipcMain.handle('documents:list', (_event, projectId: unknown) =>
    toResult(() => listDocuments(actor(), requireProjectId(projectId)))
  )

  ipcMain.handle(
    'documents:create',
    (_event, payload: { projectId?: unknown; title?: unknown }) =>
      toResult(() =>
        createDocument(
          actor(),
          requireProjectId(payload?.projectId),
          typeof payload?.title === 'string' ? payload.title : undefined
        )
      )
  )

  ipcMain.handle(
    'documents:get',
    (_event, payload: { projectId?: unknown; documentId?: unknown }) =>
      toResult(() =>
        getDocument(
          actor(),
          requireProjectId(payload?.projectId),
          requireProjectId(payload?.documentId)
        )
      )
  )

  ipcMain.handle(
    'documents:save',
    (_event, payload: { projectId?: unknown; documentId?: unknown; input?: unknown }) =>
      toResult(() =>
        saveDocument(
          actor(),
          requireProjectId(payload?.projectId),
          requireProjectId(payload?.documentId),
          (payload?.input ?? {}) as { blocks: unknown; title?: unknown; baseVersion?: unknown }
        )
      )
  )

  ipcMain.handle(
    'documents:rename',
    (_event, payload: { projectId?: unknown; documentId?: unknown; title?: unknown }) =>
      toResult(() =>
        renameDocument(
          actor(),
          requireProjectId(payload?.projectId),
          requireProjectId(payload?.documentId),
          typeof payload?.title === 'string' ? payload.title : ''
        )
      )
  )

  ipcMain.handle(
    'documents:delete',
    (_event, payload: { projectId?: unknown; documentId?: unknown }) =>
      toResult(() => {
        deleteDocument(
          actor(),
          requireProjectId(payload?.projectId),
          requireProjectId(payload?.documentId)
        )
        return null
      })
  )

  ipcMain.handle(
    'documents:versions',
    (_event, payload: { projectId?: unknown; documentId?: unknown }) =>
      toResult(() =>
        listVersions(
          actor(),
          requireProjectId(payload?.projectId),
          requireProjectId(payload?.documentId)
        )
      )
  )

  ipcMain.handle(
    'documents:restore',
    (_event, payload: { projectId?: unknown; documentId?: unknown; version?: unknown }) =>
      toResult(() =>
        restoreVersion(
          actor(),
          requireProjectId(payload?.projectId),
          requireProjectId(payload?.documentId),
          Number(payload?.version)
        )
      )
  )

  /* ---------------- presentations ---------------- */
  ipcMain.handle('presentations:list', (_event, projectId: unknown) =>
    toResult(() => listPresentations(actor(), requireProjectId(projectId)))
  )

  ipcMain.handle(
    'presentations:create',
    (_event, payload: { projectId?: unknown; title?: unknown }) =>
      toResult(() =>
        createBlankPresentation(
          actor(),
          requireProjectId(payload?.projectId),
          typeof payload?.title === 'string' ? payload.title : undefined
        )
      )
  )

  ipcMain.handle(
    'presentations:convert',
    (_event, payload: { projectId?: unknown; documentId?: unknown }) =>
      toResult(() =>
        convertDocument(
          actor(),
          requireProjectId(payload?.projectId),
          requireProjectId(payload?.documentId)
        )
      )
  )

  ipcMain.handle(
    'presentations:get',
    (_event, payload: { projectId?: unknown; presentationId?: unknown }) =>
      toResult(() =>
        getPresentation(
          actor(),
          requireProjectId(payload?.projectId),
          requireProjectId(payload?.presentationId)
        )
      )
  )

  ipcMain.handle(
    'presentations:save',
    (_event, payload: { projectId?: unknown; presentationId?: unknown; input?: unknown }) =>
      toResult(() =>
        savePresentation(
          actor(),
          requireProjectId(payload?.projectId),
          requireProjectId(payload?.presentationId),
          (payload?.input ?? {}) as { title?: unknown; theme?: unknown; slides?: unknown }
        )
      )
  )

  ipcMain.handle(
    'presentations:duplicate',
    (_event, payload: { projectId?: unknown; presentationId?: unknown }) =>
      toResult(() =>
        duplicatePresentation(
          actor(),
          requireProjectId(payload?.projectId),
          requireProjectId(payload?.presentationId)
        )
      )
  )

  ipcMain.handle(
    'presentations:delete',
    (_event, payload: { projectId?: unknown; presentationId?: unknown }) =>
      toResult(() => {
        deletePresentation(
          actor(),
          requireProjectId(payload?.projectId),
          requireProjectId(payload?.presentationId)
        )
        return null
      })
  )

  /* ---------------- project intelligence ---------------- */
  ipcMain.handle('graph:get', (_event, projectId: unknown) =>
    toResult(() => projectGraph(actor(), requireProjectId(projectId)))
  )

  /* ---------------- administration ---------------- */
  // Admin calls never use `actor()`: the admin session is a separate identity,
  // and every data handler below re-checks it inside the main process.
  ipcMain.handle('admin:status', () => toResult(() => adminStatus()))

  ipcMain.handle('admin:identity:update', (_event, input: AdminIdentityInput) =>
    toResult(() => updateAdminIdentity(input))
  )

  ipcMain.handle('admin:setup', (_event, input: AdminSetupInput) =>
    toResult(() => setupAdmin(input ?? ({} as AdminSetupInput)))
  )

  ipcMain.handle('admin:login', (_event, input: AdminLoginInput) =>
    toResult(() => adminSignIn(input ?? ({} as AdminLoginInput)))
  )

  ipcMain.handle('admin:logout', () =>
    toResult(() => {
      adminSignOut()
      return null
    })
  )

  ipcMain.handle('admin:overview', () => toResult(() => adminOverview()))

  ipcMain.handle(
    'admin:account:suspend',
    (_event, payload: { userId?: unknown; suspended?: unknown }) =>
      toResult(() => {
        setAccountSuspended(requireUserId(payload?.userId), payload?.suspended === true)
        return null
      })
  )

  ipcMain.handle(
    'admin:account:reset-password',
    (_event, payload: { userId?: unknown; password?: unknown }) =>
      toResult(() => {
        resetAccountPassword(requireUserId(payload?.userId), requireText(payload?.password, 'password'))
        return null
      })
  )

  ipcMain.handle('admin:account:delete', (_event, userId: unknown) =>
    toResult(() => {
      deleteAccount(requireUserId(userId))
      return null
    })
  )

  ipcMain.handle('admin:account:sign-out', (_event, userId: unknown) =>
    toResult(() => signOutAccount(requireUserId(userId)))
  )

  ipcMain.handle('admin:sessions:clear', () => toResult(() => signOutAllAccounts()))

  ipcMain.handle(
    'admin:project:rename',
    (_event, payload: { projectId?: unknown; name?: unknown }) =>
      toResult(() => {
        renameProject(requireProjectId(payload?.projectId), requireText(payload?.name, 'name'))
        return null
      })
  )

  ipcMain.handle(
    'admin:project:transfer',
    (_event, payload: { projectId?: unknown; ownerId?: unknown }) =>
      toResult(() => {
        transferProject(requireProjectId(payload?.projectId), requireUserId(payload?.ownerId))
        return null
      })
  )

  ipcMain.handle('admin:project:delete', (_event, projectId: unknown) =>
    toResult(() => {
      deleteProject(requireProjectId(projectId))
      return null
    })
  )

  ipcMain.handle('admin:document:delete', (_event, documentId: unknown) =>
    toResult(() => {
      deleteDocumentAsAdmin(requireRecordId(documentId))
      return null
    })
  )

  ipcMain.handle('admin:presentation:delete', (_event, presentationId: unknown) =>
    toResult(() => {
      deletePresentationAsAdmin(requireRecordId(presentationId))
      return null
    })
  )

  ipcMain.handle('admin:settings:update', (_event, input: AdminSettings) =>
    toResult(() => {
      const next = updateSettings(input)
      // Every installation, including a new one, follows this row.
      queuePush()
      return next
    })
  )

  /*
   * The video is chosen with the native file picker and copied by the main
   * process. The renderer never receives a filesystem path, and a dismissed
   * dialog returns null so the panel can tell "cancelled" from "failed".
   */
  ipcMain.handle('admin:appearance:choose-video', (event) =>
    toResult(async (): Promise<LoginAppearance | null> => {
      requireAdmin()
      const window = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = {
        title: 'Choose a background video',
        buttonLabel: 'Use this video',
        properties: ['openFile'],
        filters: [
          { name: 'Video', extensions: ['mp4', 'm4v', 'webm', 'ogv'] },
          { name: 'All files', extensions: ['*'] }
        ]
      }
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      const chosen = result.canceled ? null : (result.filePaths[0] ?? null)
      if (!chosen) return null
      const next = installAppearanceVideo(chosen, basename(chosen))
      // The bytes are published by the workspace client, which uploads them
      // before it updates the row.
      queuePush()
      return next
    })
  )

  ipcMain.handle('admin:appearance:remove-video', () =>
    toResult(() => {
      const next = clearAppearanceVideo()
      queuePush()
      return next
    })
  )

  ipcMain.handle('admin:appearance:treatment', (_event, input: AppearanceTreatment) =>
    toResult(() => {
      const next = updateAppearanceTreatment(input)
      queuePush()
      return next
    })
  )

  /* ---------------- cloud workspace ---------------- */
  /*
   * Everything here is administrator-only, including the read: it carries the
   * account email and what the machine is doing. The renderer never sees a
   * token, and no call here can be made without an administrator session.
   */
  ipcMain.handle('admin:workspace:state', () =>
    toResult(() => {
      requireAdmin()
      return workspaceState()
    })
  )

  ipcMain.handle('admin:workspace:sign-in', (_event, input: WorkspaceCredentialsInput) =>
    toResult(() => {
      requireAdmin()
      return signInWorkspace(input)
    })
  )

  ipcMain.handle('admin:workspace:sign-up', (_event, input: WorkspaceCredentialsInput) =>
    toResult(() => {
      requireAdmin()
      return signUpWorkspace(input)
    })
  )

  ipcMain.handle('admin:workspace:sign-out', () =>
    toResult(() => {
      requireAdmin()
      return signOutWorkspace()
    })
  )

  ipcMain.handle('admin:workspace:claim', (_event, input: WorkspaceClaimInput) =>
    toResult(() => {
      requireAdmin()
      return claimWorkspace(input?.code ?? '')
    })
  )

  ipcMain.handle('admin:workspace:sync', () =>
    toResult(async () => {
      requireAdmin()
      await reconcile()
      return push()
    })
  )

  ipcMain.handle('admin:workspace:discard', () =>
    toResult(async () => {
      requireAdmin()
      return discardPending()
    })
  )

  // What the panel uses for its playback check: is the file there, and can the
  // main process still read it back?
  ipcMain.handle('admin:appearance:health', () =>
    toResult(() => {
      requireAdmin()
      return backgroundHealth()
    })
  )

  ipcMain.handle(
    'admin:keys:create',
    (_event, input: { count?: unknown; label?: unknown; expiresInDays?: unknown }) =>
      toResult(() =>
        createKeys({
          count: Number(input?.count ?? 1),
          label: typeof input?.label === 'string' ? input.label : '',
          expiresInDays:
            input?.expiresInDays === null || input?.expiresInDays === undefined
              ? null
              : Number(input.expiresInDays)
        })
      )
  )

  ipcMain.handle('admin:keys:revoke', (_event, id: unknown) =>
    toResult(() => {
      revokeKey(requireRecordId(id))
      return null
    })
  )

  ipcMain.handle('admin:keys:delete', (_event, id: unknown) =>
    toResult(() => {
      removeKey(requireRecordId(id))
      return null
    })
  )

  ipcMain.handle(
    'admin:password:change',
    (_event, payload: { currentPassword?: unknown; newPassword?: unknown }) =>
      toResult(() => {
        changeAdminPassword(
          requireText(payload?.currentPassword, 'current password'),
          requireText(payload?.newPassword, 'new password')
        )
        return null
      })
  )

  /* ---------------- team search ---------------- */
  ipcMain.handle(
    'users:search',
    (_event, payload: { projectId?: unknown; query?: unknown }) =>
      toResult(() => {
        const viewer = actor()
        const projectId = requireProjectId(payload?.projectId)
        assertCanManageTeam(viewer, projectId)
        return searchUsers(validateSearchQuery(payload?.query), projectId)
      })
  )
}
