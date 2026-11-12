import { ipcMain } from 'electron'
import type {
  ChangePasswordInput,
  CreateProjectInput,
  DeleteAccountInput,
  LoginInput,
  ProfileInput,
  RegisterInput,
  SessionUser
} from '@shared/types'
import { toResult } from '../lib/errors'
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
  signOutAccount,
  signOutAllAccounts,
  transferProject,
  updateAdminIdentity,
  updateSettings
} from '../services/admin'
import { publicStatus } from '../services/settings'
import { checkForUpdates, installUpdate, updateState } from '../services/updates'
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

  /* ---------------- optional Supabase connection ---------------- */
  // Machine-level configuration, so it is only reachable once someone is
  // signed in — never from the signed-out screens.
  ipcMain.handle('backend:status', () =>
    toResult(() => {
      actor()
      return backendStatus()
    })
  )

  ipcMain.handle('backend:test', () =>
    toResult(() => {
      actor()
      return testBackendConnection()
    })
  )

  ipcMain.handle('backend:save', (_event, input: BackendConfigInput) =>
    toResult(() => {
      actor()
      return saveBackendConfig(input ?? { url: '', key: '' })
    })
  )

  ipcMain.handle('backend:clear', () =>
    toResult(() => {
      actor()
      return clearBackendConfig()
    })
  )

  /* ---------------- self-update ---------------- */
  // Readable by any renderer: the state is only a version number and progress.
  ipcMain.handle('updates:state', () => toResult(() => updateState()))
  ipcMain.handle('updates:check', () => toResult(() => checkForUpdates(true)))
  ipcMain.handle('updates:install', () => toResult(() => installUpdate()))

  /* ---------------- accounts ---------------- */
  ipcMain.handle('auth:register', (_event, input: RegisterInput) =>
    toResult(() => register(input ?? ({} as RegisterInput)))
  )

  ipcMain.handle('auth:login', (_event, input: LoginInput) =>
    toResult(() => signIn(input ?? ({} as LoginInput)))
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
  ipcMain.handle('projects:list', () => toResult(() => listProjects(actor())))

  ipcMain.handle('projects:create', (_event, input: CreateProjectInput) =>
    toResult(() => createProject(actor(), input ?? ({} as CreateProjectInput)))
  )

  ipcMain.handle('projects:get', (_event, projectId: unknown) =>
    toResult(() => getProject(actor(), requireProjectId(projectId)))
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
    toResult(() => updateSettings(input))
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
