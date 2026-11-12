import { contextBridge, ipcRenderer } from 'electron'
import type {
  ApiResult,
  CreateProjectInput,
  DocumentDetail,
  DocumentSummary,
  DocumentVersionSummary,
  AdminAccount,
  AdminLoginInput,
  AdminOverview,
  AdminSettings,
  AdminSetupInput,
  AdminStatus,
  AppPublicStatus,
  ChangePasswordInput,
  CreateActivationKeyInput,
  CreatedActivationKey,
  DeleteAccountInput,
  LoginInput,
  ProfileInput,
  PresentationDetail,
  PresentationSummary,
  ProjectDetail,
  ProjectGraph,
  ProjectSummary,
  RegisterInput,
  SessionUser,
  UserSummary
} from '@shared/types'

/**
 * The renderer runs sandboxed with context isolation, so it only ever sees
 * the small, typed surface exposed here. No database, no filesystem, no tokens.
 */
const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),

  auth: {
    register: (input: RegisterInput): Promise<ApiResult<SessionUser>> =>
      ipcRenderer.invoke('auth:register', input),
    login: (input: LoginInput): Promise<ApiResult<SessionUser>> =>
      ipcRenderer.invoke('auth:login', input),
    logout: (): Promise<ApiResult<null>> => ipcRenderer.invoke('auth:logout'),
    current: (): Promise<ApiResult<SessionUser | null>> => ipcRenderer.invoke('auth:session'),
    updateProfile: (input: ProfileInput): Promise<ApiResult<SessionUser>> =>
      ipcRenderer.invoke('auth:update-profile', input),
    changePassword: (input: ChangePasswordInput): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('auth:change-password', input),
    deleteAccount: (input: DeleteAccountInput): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('auth:delete-account', input)
  },

  users: {
    search: (input: { projectId: string; query: string }): Promise<ApiResult<UserSummary[]>> =>
      ipcRenderer.invoke('users:search', input)
  },

  projects: {
    list: (): Promise<ApiResult<ProjectSummary[]>> => ipcRenderer.invoke('projects:list'),
    create: (input: CreateProjectInput): Promise<ApiResult<ProjectDetail>> =>
      ipcRenderer.invoke('projects:create', input),
    get: (projectId: string): Promise<ApiResult<ProjectDetail>> =>
      ipcRenderer.invoke('projects:get', projectId),
    addMember: (input: { projectId: string; userId: string }): Promise<ApiResult<ProjectDetail>> =>
      ipcRenderer.invoke('projects:add-member', input),
    removeMember: (input: {
      projectId: string
      userId: string
    }): Promise<ApiResult<ProjectDetail>> => ipcRenderer.invoke('projects:remove-member', input)
  },

  documents: {
    list: (projectId: string): Promise<ApiResult<DocumentSummary[]>> =>
      ipcRenderer.invoke('documents:list', projectId),
    create: (payload: { projectId: string; title?: string }): Promise<ApiResult<DocumentDetail>> =>
      ipcRenderer.invoke('documents:create', payload),
    get: (payload: { projectId: string; documentId: string }): Promise<ApiResult<DocumentDetail>> =>
      ipcRenderer.invoke('documents:get', payload),
    save: (payload: {
      projectId: string
      documentId: string
      input: { blocks: unknown; title?: string; baseVersion?: number }
    }): Promise<ApiResult<DocumentDetail>> => ipcRenderer.invoke('documents:save', payload),
    rename: (payload: {
      projectId: string
      documentId: string
      title: string
    }): Promise<ApiResult<DocumentSummary>> => ipcRenderer.invoke('documents:rename', payload),
    remove: (payload: {
      projectId: string
      documentId: string
    }): Promise<ApiResult<null>> => ipcRenderer.invoke('documents:delete', payload),
    versions: (payload: {
      projectId: string
      documentId: string
    }): Promise<ApiResult<DocumentVersionSummary[]>> => ipcRenderer.invoke('documents:versions', payload),
    restore: (payload: {
      projectId: string
      documentId: string
      version: number
    }): Promise<ApiResult<DocumentDetail>> => ipcRenderer.invoke('documents:restore', payload)
  },

  presentations: {
    list: (projectId: string): Promise<ApiResult<PresentationSummary[]>> =>
      ipcRenderer.invoke('presentations:list', projectId),
    create: (payload: {
      projectId: string
      title?: string
    }): Promise<ApiResult<PresentationDetail>> => ipcRenderer.invoke('presentations:create', payload),
    convert: (payload: {
      projectId: string
      documentId: string
    }): Promise<ApiResult<PresentationDetail>> => ipcRenderer.invoke('presentations:convert', payload),
    get: (payload: {
      projectId: string
      presentationId: string
    }): Promise<ApiResult<PresentationDetail>> => ipcRenderer.invoke('presentations:get', payload),
    save: (payload: {
      projectId: string
      presentationId: string
      input: { title?: string; theme?: string; slides?: unknown }
    }): Promise<ApiResult<PresentationDetail>> => ipcRenderer.invoke('presentations:save', payload),
    duplicate: (payload: {
      projectId: string
      presentationId: string
    }): Promise<ApiResult<PresentationDetail>> =>
      ipcRenderer.invoke('presentations:duplicate', payload),
    remove: (payload: {
      projectId: string
      presentationId: string
    }): Promise<ApiResult<null>> => ipcRenderer.invoke('presentations:delete', payload)
  },

  graph: {
    get: (projectId: string): Promise<ApiResult<ProjectGraph>> =>
      ipcRenderer.invoke('graph:get', projectId)
  },

  app: {
    status: (): Promise<ApiResult<AppPublicStatus>> => ipcRenderer.invoke('app:status')
  },

  admin: {
    status: (): Promise<ApiResult<AdminStatus>> => ipcRenderer.invoke('admin:status'),
    setup: (input: AdminSetupInput): Promise<ApiResult<AdminAccount>> =>
      ipcRenderer.invoke('admin:setup', input),
    login: (input: AdminLoginInput): Promise<ApiResult<AdminAccount>> =>
      ipcRenderer.invoke('admin:login', input),
    logout: (): Promise<ApiResult<null>> => ipcRenderer.invoke('admin:logout'),
    overview: (): Promise<ApiResult<AdminOverview>> => ipcRenderer.invoke('admin:overview'),
    suspendAccount: (payload: {
      userId: string
      suspended: boolean
    }): Promise<ApiResult<null>> => ipcRenderer.invoke('admin:account:suspend', payload),
    resetPassword: (payload: {
      userId: string
      password: string
    }): Promise<ApiResult<null>> => ipcRenderer.invoke('admin:account:reset-password', payload),
    deleteAccount: (userId: string): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('admin:account:delete', userId),
    signOutAccount: (userId: string): Promise<ApiResult<{ cleared: boolean }>> =>
      ipcRenderer.invoke('admin:account:sign-out', userId),
    signOutAll: (): Promise<ApiResult<{ cleared: boolean }>> =>
      ipcRenderer.invoke('admin:sessions:clear'),
    renameProject: (payload: {
      projectId: string
      name: string
    }): Promise<ApiResult<null>> => ipcRenderer.invoke('admin:project:rename', payload),
    transferProject: (payload: {
      projectId: string
      ownerId: string
    }): Promise<ApiResult<null>> => ipcRenderer.invoke('admin:project:transfer', payload),
    deleteProject: (projectId: string): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('admin:project:delete', projectId),
    deleteDocument: (documentId: string): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('admin:document:delete', documentId),
    deletePresentation: (presentationId: string): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('admin:presentation:delete', presentationId),
    updateSettings: (input: AdminSettings): Promise<ApiResult<AdminSettings>> =>
      ipcRenderer.invoke('admin:settings:update', input),
    createKeys: (input: CreateActivationKeyInput): Promise<ApiResult<CreatedActivationKey[]>> =>
      ipcRenderer.invoke('admin:keys:create', input),
    revokeKey: (id: string): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('admin:keys:revoke', id),
    deleteKey: (id: string): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('admin:keys:delete', id),
    changePassword: (payload: {
      currentPassword: string
      newPassword: string
    }): Promise<ApiResult<null>> => ipcRenderer.invoke('admin:password:change', payload)
  },

  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    toggleMaximize: (): void => ipcRenderer.send('window:toggle-maximize'),
    close: (): void => ipcRenderer.send('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (listener: (maximized: boolean) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean): void =>
        listener(maximized)
      ipcRenderer.on('window:state', handler)
      return () => ipcRenderer.removeListener('window:state', handler)
    }
  }
} as const

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('indra', api)
  } catch (error) {
    console.error('[preload] failed to expose bridge', error)
  }
}
