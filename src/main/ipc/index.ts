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
import { errors, toResult } from '../lib/errors'
import { archiveProject, exportProjectToFile, importProjectFromFile, restoreArchive } from '../services/archive'
import { recheckConnectivity } from '../services/connectivity'
import {
  adoptCloudKey,
  cloudProjectState,
  cloudState,
  exportCloudKey,
  forgetCloudIdentity,
  listCloudProjects,
  pullProject,
  pushProject
} from '../services/cloud'
import {
  answerSharedInvitation,
  cancelShare,
  listConflicts,
  pendingShares,
  resolveConflict,
  shareByEmail,
  sharedInvitations,
  syncProject
} from '../services/sharing'
import { librarySnapshot } from '../services/library'
import { validateEmailQuery } from '../lib/validation'
import {
  changeOwnPassword,
  currentUser,
  deleteOwnAccount,
  register,
  requireUser,
  signIn,
  signOut,
  startOfflineWorkspace,
  updateProfile
} from '../services/auth'
import { claimOfflineWork, offlineWork } from '../services/offline'
import { myInvitations, respond, revoke } from '../services/invitations'
import {
  assertCanManageTeam,
  createProject,
  getProject,
  inviteMember,
  listProjects,
  removeMember
} from '../services/projects'
import { searchUsers } from '../services/users'
import {
  activity as aiActivity,
  adminCreditSnapshot,
  adminDecidePurchase,
  adminGrant,
  adminLedger,
  adminSetPlan,
  adminUpdatePlan,
  ask as askAI,
  cancelPurchase,
  creditLedger,
  creditPlans,
  creditsState,
  purchaseRequests,
  requestPurchase
} from '../services/ai'
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
import { installDeveloperPhoto, readAbout, readDeveloperPhotoFile, removeDeveloperPhoto } from '../services/about'
import {
  inviteTeamMember,
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

/**
 * Anything that talks to an account rather than to this disk.
 *
 * The offline workspace is not an account: it has no cloud copy to push, no team
 * to join and no profile in the cloud. Refusing here means the rule holds even
 * if a screen forgets it.
 */
function accountActor(): SessionUser {
  const user = requireUser()
  if (user.mode === 'offline') {
    throw errors.authRequired()
  }
  return user
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

  /* ---------------- the offline workspace ---------------- */
  /*
   * Offline is a workspace, not an account. Opening it creates the local
   * profile that owns offline work — with a password nobody can know — and a
   * session marked `offline`, so every screen below knows there is no account.
   */
  ipcMain.handle('offline:start', () => toResult(() => startOfflineWorkspace()))

  ipcMain.handle('offline:summary', () =>
    toResult(() => {
      const user = requireUser()
      return user.mode === 'offline' ? { projects: 0, documents: 0, presentations: 0 } : offlineWork()
    })
  )

  ipcMain.handle('offline:claim', () => toResult(() => claimOfflineWork(actor())))

  /* ---------------- offline library ---------------- */
  // Every document and deck the account can reach, in one read.
  ipcMain.handle('library:snapshot', () => toResult(() => librarySnapshot(actor())))

  /* ---------------- the cloud copy ---------------- */
  /*
   * Every one of these is refused by the main process while the machine is
   * offline, and every write carries only the installation's own token — the
   * database's RLS policies, not this IPC layer, decide what an account may
   * reach. `cloud:project` reads timestamps from disk and works offline, which
   * is why the project page can still say where the copy stands with no route
   * out.
   */
  ipcMain.handle('cloud:state', () => toResult(() => cloudState(accountActor())))

  ipcMain.handle('cloud:project', (_event, projectId: unknown) =>
    toResult(() => cloudProjectState(actor(), requireProjectId(projectId)))
  )

  ipcMain.handle('cloud:list', () => toResult(() => listCloudProjects(accountActor())))

  ipcMain.handle('cloud:push', (_event, projectId: unknown) =>
    toResult(() => pushProject(accountActor(), requireProjectId(projectId)))
  )

  ipcMain.handle('cloud:pull', (_event, cloudId: unknown) =>
    toResult(() => {
      if (typeof cloudId !== 'string' || cloudId.length === 0 || cloudId.length > 160) {
        throw new Error('invalid cloud project id')
      }
      return pullProject(accountActor(), cloudId)
    })
  )

  /*
   * Moving the copy to another PC. The code is this PC's cloud identity; it is
   * only produced when asked for, and only stored by another machine that
   * proves the password still works.
   */
  ipcMain.handle('cloud:key', () =>
    toResult(() => {
      accountActor()
      return exportCloudKey(accountActor())
    })
  )

  ipcMain.handle('cloud:adopt', (_event, code: unknown) =>
    toResult(() => {
      if (typeof code !== 'string' || code.length === 0 || code.length > 600) {
        throw new Error('invalid transfer code')
      }
      return adoptCloudKey(accountActor(), code)
    })
  )

  ipcMain.handle('cloud:forget', () => toResult(() => {
    forgetCloudIdentity(accountActor())
    return null
  }))

  /*
   * One project, two PCs.
   *
   * An owner invites an address (the project is saved first if it has never
   * been); the person on the other machine sees the question, accepts, and the
   * project is brought down as their own working copy. Sync is explicit, and a
   * conflict is a question with two answers, never a merge made on the
   * person's behalf.
   */
  ipcMain.handle('share:invite', (_event, projectId: unknown, email: unknown) =>
    toResult(() => {
      const address = typeof email === 'string' ? email.trim() : ''
      if (address.length === 0 || address.length > 254) throw new Error('invalid email')
      return shareByEmail(accountActor(), requireProjectId(projectId), address)
    })
  )

  ipcMain.handle('share:inbox', () => toResult(() => sharedInvitations(accountActor())))

  ipcMain.handle('share:pending', (_event, projectId: unknown) =>
    toResult(() => pendingShares(accountActor(), requireProjectId(projectId)))
  )

  ipcMain.handle('share:answer', (_event, id: unknown, cloudId: unknown, accept: unknown) =>
    toResult(() => {
      if (typeof id !== 'string' || id.length === 0 || id.length > 80) throw new Error('invalid id')
      if (typeof cloudId !== 'string' || cloudId.length === 0 || cloudId.length > 160) {
        throw new Error('invalid cloud id')
      }
      return answerSharedInvitation(accountActor(), id, cloudId, accept === true)
    })
  )

  ipcMain.handle('share:cancel', (_event, id: unknown) =>
    toResult(() => {
      if (typeof id !== 'string' || id.length === 0 || id.length > 80) throw new Error('invalid id')
      return cancelShare(accountActor(), id)
    })
  )

  ipcMain.handle('share:conflicts', (_event, projectId: unknown) =>
    toResult(() => listConflicts(accountActor(), requireProjectId(projectId)))
  )

  ipcMain.handle('share:sync', (_event, projectId: unknown) =>
    toResult(() => syncProject(accountActor(), requireProjectId(projectId)))
  )

  ipcMain.handle('share:resolve', (_event, conflictId: unknown, choice: unknown) =>
    toResult(() => {
      if (typeof conflictId !== 'string' || conflictId.length === 0 || conflictId.length > 80) {
        throw new Error('invalid conflict')
      }
      return resolveConflict(
        accountActor(),
        conflictId,
        choice === 'cloud' ? 'cloud' : 'local'
      )
    })
  )

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

  ipcMain.handle('team:invite', (_event, ref: unknown) =>
    toResult(() => inviteTeamMember(actor(), ref))
  )

  /*
   * Invitations are answered by the person they name, not by the owner of the
   * team or project. The service checks whose invitation it is, so a guessed id
   * is refused rather than acted on.
   */
  ipcMain.handle('invitations:list', () => toResult(() => myInvitations(actor())))

  ipcMain.handle('invitations:accept', (_event, invitationId: unknown) =>
    toResult(() => respond(actor(), String(invitationId ?? ''), true))
  )

  ipcMain.handle('invitations:decline', (_event, invitationId: unknown) =>
    toResult(() => respond(actor(), String(invitationId ?? ''), false))
  )

  ipcMain.handle('invitations:cancel', (_event, invitationId: unknown) =>
    toResult(() => revoke(actor(), String(invitationId ?? '')))
  )

  ipcMain.handle('team:remove-member', (_event, userId: unknown) =>
    toResult(() => removeTeamMember(actor(), userId))
  )

  ipcMain.handle('team:search', (_event, query: unknown) =>
    toResult(() => searchTeamCandidates(actor(), validateEmailQuery(query)))
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
    'projects:invite',
    (_event, payload: { projectId?: unknown; userId?: unknown }) =>
      toResult(() =>
        inviteMember(
          actor(),
          requireProjectId(payload?.projectId),
          String(payload?.userId ?? '')
        )
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
        return searchUsers(validateEmailQuery(payload?.query), projectId)
      })
  )

  /* ---------------- credits and AI ---------------- */

  /*
   * The balance is read here, in the main process, with the account's own cloud
   * token. The renderer receives numbers and timestamps — never a credential,
   * and never the authority to spend.
   */
  ipcMain.handle('credits:state', (_event, payload: { cached?: unknown }) =>
    toResult(() => creditsState(actor(), payload?.cached === true))
  )

  ipcMain.handle('credits:plans', () => toResult(() => creditPlans(actor())))

  ipcMain.handle('credits:ledger', (_event, payload: { limit?: unknown }) =>
    toResult(() => creditLedger(actor(), Number(payload?.limit ?? 40)))
  )

  ipcMain.handle('credits:purchases', () => toResult(() => purchaseRequests(actor())))

  ipcMain.handle(
    'credits:request',
    (_event, payload: { kind?: unknown; planId?: unknown; credits?: unknown; note?: unknown }) =>
      toResult(() =>
        requestPurchase(actor(), {
          kind: payload?.kind === 'credits' ? 'credits' : 'plan',
          planId: typeof payload?.planId === 'string' ? payload.planId : undefined,
          credits: payload?.credits === undefined ? undefined : Number(payload.credits),
          note: typeof payload?.note === 'string' ? payload.note : ''
        })
      )
  )

  ipcMain.handle('credits:cancel', (_event, id: unknown) =>
    toResult(() => cancelPurchase(actor(), requireRecordId(id)))
  )

  ipcMain.handle('ai:activity', (_event, payload: { limit?: unknown }) =>
    toResult(() => aiActivity(actor(), Number(payload?.limit ?? 20)))
  )

  ipcMain.handle(
    'ai:ask',
    (
      _event,
      payload: {
        projectId?: unknown
        documentId?: unknown
        prompt?: unknown
        selection?: unknown
        language?: unknown
        history?: unknown
      }
    ) =>
      toResult(() =>
        askAI(
          actor(),
          {
            projectId: requireProjectId(payload?.projectId),
            documentId: requireRecordId(payload?.documentId),
            prompt: typeof payload?.prompt === 'string' ? payload.prompt : '',
            selection: typeof payload?.selection === 'string' ? payload.selection : undefined,
            language: typeof payload?.language === 'string' ? payload.language : undefined,
            history: Array.isArray(payload?.history)
              ? (payload.history as Array<{ role: 'user' | 'model'; text: string }>)
              : undefined
          },
          'chat'
        )
      )
  )

  ipcMain.handle(
    'ai:research',
    (
      _event,
      payload: {
        projectId?: unknown
        documentId?: unknown
        prompt?: unknown
        selection?: unknown
        language?: unknown
        depth?: unknown
        history?: unknown
      }
    ) =>
      toResult(() =>
        askAI(
          actor(),
          {
            projectId: requireProjectId(payload?.projectId),
            documentId: requireRecordId(payload?.documentId),
            prompt: typeof payload?.prompt === 'string' ? payload.prompt : '',
            selection: typeof payload?.selection === 'string' ? payload.selection : undefined,
            language: typeof payload?.language === 'string' ? payload.language : undefined,
            depth: payload?.depth === 'deep' ? 'deep' : 'standard',
            history: Array.isArray(payload?.history)
              ? (payload.history as Array<{ role: 'user' | 'model'; text: string }>)
              : undefined
          },
          'research'
        )
      )
  )

  /*
   * Credit administration. Two gates: the local administrator session, and —
   * inside every one of these calls — the server's own check that the signed-in
   * cloud account holds the administrator role. Either one alone is not enough.
   */
  ipcMain.handle('admin:credits:snapshot', () =>
    toResult(() => {
      requireAdmin()
      return adminCreditSnapshot(actor())
    })
  )

  ipcMain.handle(
    'admin:credits:decide',
    (_event, payload: { id?: unknown; approve?: unknown; note?: unknown }) =>
      toResult(() => {
        requireAdmin()
        return adminDecidePurchase(
          actor(),
          requireRecordId(payload?.id),
          payload?.approve === true,
          typeof payload?.note === 'string' ? payload.note : ''
        )
      })
  )

  ipcMain.handle(
    'admin:credits:setPlan',
    (_event, payload: { userId?: unknown; planId?: unknown; days?: unknown }) =>
      toResult(() => {
        requireAdmin()
        return adminSetPlan(
          actor(),
          requireRecordId(payload?.userId),
          requireRecordId(payload?.planId),
          Number(payload?.days ?? 30)
        )
      })
  )

  ipcMain.handle(
    'admin:credits:grant',
    (_event, payload: { userId?: unknown; amount?: unknown; reason?: unknown }) =>
      toResult(() => {
        requireAdmin()
        return adminGrant(
          actor(),
          requireRecordId(payload?.userId),
          Number(payload?.amount ?? 0),
          typeof payload?.reason === 'string' ? payload.reason : ''
        )
      })
  )

  ipcMain.handle(
    'admin:credits:updatePlan',
    (_event, payload: { id?: unknown; name?: unknown; dailyCredits?: unknown; priceInr?: unknown; blurb?: unknown }) =>
      toResult(() => {
        requireAdmin()
        return adminUpdatePlan(actor(), {
          id: requireRecordId(payload?.id),
          name: typeof payload?.name === 'string' ? payload.name : undefined,
          dailyCredits: payload?.dailyCredits === undefined ? undefined : Number(payload.dailyCredits),
          priceInr: payload?.priceInr === undefined ? undefined : Number(payload.priceInr),
          blurb: typeof payload?.blurb === 'string' ? payload.blurb : undefined
        })
      })
  )

  ipcMain.handle('admin:credits:ledger', (_event, payload: { userId?: unknown; limit?: unknown }) =>
    toResult(() => {
      requireAdmin()
      return adminLedger(actor(), requireRecordId(payload?.userId), Number(payload?.limit ?? 40))
    })
  )

  /* ---------------- about ---------------- */

  /*
   * The About card is public: it is the app's name, its version and the
   * administrator's portrait. Reading it needs no session, and nothing here
   * returns a path — only metadata, and bytes on request.
   */
  ipcMain.handle('about:read', () => toResult(() => readAbout()))

  ipcMain.handle('about:photo', () =>
    toResult(() => {
      const file = readDeveloperPhotoFile()
      return file ? { bytes: file.bytes, mime: file.mime } : null
    })
  )

  ipcMain.handle('admin:about:photo:choose', (event) =>
    toResult(async (): Promise<import('@shared/types').AboutInfo | null> => {
      requireAdmin()
      const window = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = {
        title: 'Choose a developer photo',
        buttonLabel: 'Use this photo',
        properties: ['openFile'],
        filters: [
          { name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
          { name: 'All files', extensions: ['*'] }
        ]
      }
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return null
      const filePath = result.filePaths[0]
      return installDeveloperPhoto(filePath, basename(filePath))
    })
  )

  ipcMain.handle('admin:about:photo:remove', () =>
    toResult(() => {
      requireAdmin()
      return removeDeveloperPhoto()
    })
  )
}
