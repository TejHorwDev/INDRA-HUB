import { contextBridge, ipcRenderer } from 'electron'
import type {
  ApiResult,
  CreateProjectInput,
  DocumentDetail,
  DocumentSummary,
  DocumentVersionSummary,
  AdminAccount,
  AdminIdentityInput,
  AdminLoginInput,
  AdminOverview,
  AdminSettings,
  AdminSetupInput,
  AdminStatus,
  AppPublicStatus,
  AppearanceTreatment,
  ConnectivityState,
  LibrarySnapshot,
  ProjectArchive,
  ChangePasswordInput,
  CreateActivationKeyInput,
  CreatedActivationKey,
  DeleteAccountInput,
  LoginAppearance,
  LoginInput,
  ProfileInput,
  PublicAppearance,
  PresentationDetail,
  PresentationSummary,
  ProjectDetail,
  ProjectGraph,
  ProjectSummary,
  TeamDetail,
  TeamOverview,
  RegisterInput,
  WorkspaceClaimInput,
  WorkspaceCredentialsInput,
  WorkspaceState,
  BackendConfigInput,
  BackendStatus,
  SessionUser,
  UpdateDiagnostics,
  UpdateState,
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

  appearance: {
    read: (): Promise<ApiResult<PublicAppearance>> => ipcRenderer.invoke('app:appearance'),
    video: (): Promise<ApiResult<{ bytes: Uint8Array; mime: string } | null>> =>
      ipcRenderer.invoke('app:appearance:video')
  },

  auth: {
    register: (input: RegisterInput): Promise<ApiResult<SessionUser>> =>
      ipcRenderer.invoke('auth:register', input),
    login: (input: LoginInput): Promise<ApiResult<SessionUser>> =>
      ipcRenderer.invoke('auth:login', input),
    adminLogin: (input: { identifier: string; password: string }): Promise<ApiResult<AdminAccount | null>> =>
      ipcRenderer.invoke('auth:admin-login', input),
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

  team: {
    read: (): Promise<ApiResult<TeamOverview>> => ipcRenderer.invoke('team:read'),
    create: (input: { name?: string }): Promise<ApiResult<TeamDetail>> =>
      ipcRenderer.invoke('team:create', input),
    rename: (input: { name?: string }): Promise<ApiResult<TeamDetail>> =>
      ipcRenderer.invoke('team:rename', input),
    remove: (): Promise<ApiResult<TeamOverview>> => ipcRenderer.invoke('team:delete'),
    addMember: (userId: string): Promise<ApiResult<TeamDetail>> =>
      ipcRenderer.invoke('team:add-member', userId),
    removeMember: (userId: string): Promise<ApiResult<TeamDetail>> =>
      ipcRenderer.invoke('team:remove-member', userId),
    search: (query: string): Promise<ApiResult<UserSummary[]>> =>
      ipcRenderer.invoke('team:search', query)
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
    }): Promise<ApiResult<ProjectDetail>> => ipcRenderer.invoke('projects:remove-member', input),
    /** A copy on this PC: the system dialog, then a file the user owns. */
    exportFile: (projectId: string): Promise<ApiResult<{ filePath: string } | null>> =>
      ipcRenderer.invoke('projects:export', projectId),
    importFile: (): Promise<ApiResult<{ project: ProjectDetail; fileName: string } | null>> =>
      ipcRenderer.invoke('projects:import'),
    /** The archive as data, for a caller that already has the file. */
    archive: (projectId: string): Promise<ApiResult<ProjectArchive>> =>
      ipcRenderer.invoke('projects:archive', projectId),
    restore: (raw: string): Promise<ApiResult<ProjectDetail>> =>
      ipcRenderer.invoke('projects:restore', raw)
  },

  library: {
    snapshot: (): Promise<ApiResult<LibrarySnapshot>> => ipcRenderer.invoke('library:snapshot')
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
    status: (): Promise<ApiResult<AppPublicStatus>> => ipcRenderer.invoke('app:status'),
    connectivity: (): Promise<ApiResult<ConnectivityState>> =>
      ipcRenderer.invoke('app:connectivity'),
    onConnectivity: (listener: (state: ConnectivityState) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: ConnectivityState): void =>
        listener(state)
      ipcRenderer.on('connectivity:changed', handler)
      return () => ipcRenderer.removeListener('connectivity:changed', handler)
    }
  },

  updates: {
    state: (): Promise<ApiResult<UpdateState>> => ipcRenderer.invoke('updates:state'),
    check: (): Promise<ApiResult<UpdateState>> => ipcRenderer.invoke('updates:check'),
    install: (): Promise<ApiResult<UpdateState>> => ipcRenderer.invoke('updates:install'),
    diagnose: (): Promise<ApiResult<UpdateDiagnostics>> => ipcRenderer.invoke('updates:diagnose'),
    /** Main-process progress pushes; returns an unsubscribe function. */
    onState: (listener: (state: UpdateState) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, next: UpdateState): void => listener(next)
      ipcRenderer.on('update:state', handler)
      return () => ipcRenderer.removeListener('update:state', handler)
    }
  },

  backend: {
    status: (): Promise<ApiResult<BackendStatus>> => ipcRenderer.invoke('backend:status'),
    test: (): Promise<ApiResult<BackendStatus>> => ipcRenderer.invoke('backend:test'),
    save: (input: BackendConfigInput): Promise<ApiResult<BackendStatus>> =>
      ipcRenderer.invoke('backend:save', input),
    clear: (): Promise<ApiResult<BackendStatus>> => ipcRenderer.invoke('backend:clear')
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
    }): Promise<ApiResult<null>> => ipcRenderer.invoke('admin:password:change', payload),
    updateIdentity: (payload: AdminIdentityInput): Promise<ApiResult<AdminAccount>> =>
      ipcRenderer.invoke('admin:identity:update', payload),
    chooseLoginVideo: (): Promise<ApiResult<LoginAppearance | null>> =>
      ipcRenderer.invoke('admin:appearance:choose-video'),
    removeLoginVideo: (): Promise<ApiResult<LoginAppearance>> =>
      ipcRenderer.invoke('admin:appearance:remove-video'),
    updateAppearanceTreatment: (input: AppearanceTreatment): Promise<ApiResult<LoginAppearance>> =>
      ipcRenderer.invoke('admin:appearance:treatment', input),
    appearanceHealth: (): Promise<
      ApiResult<{ present: boolean; readable: boolean; bytes: number; mime: string | null }>
    > => ipcRenderer.invoke('admin:appearance:health')
  },

  /*
   * The shared workspace. Everything is administrator-only, and nothing here
   * ever hands the renderer a token or a key: only state, and answers.
   */
  workspace: {
    state: (): Promise<ApiResult<WorkspaceState>> => ipcRenderer.invoke('admin:workspace:state'),
    signIn: (input: WorkspaceCredentialsInput): Promise<ApiResult<WorkspaceState>> =>
      ipcRenderer.invoke('admin:workspace:sign-in', input),
    signUp: (input: WorkspaceCredentialsInput): Promise<ApiResult<WorkspaceState>> =>
      ipcRenderer.invoke('admin:workspace:sign-up', input),
    signOut: (): Promise<ApiResult<WorkspaceState>> => ipcRenderer.invoke('admin:workspace:sign-out'),
    claim: (input: WorkspaceClaimInput): Promise<ApiResult<WorkspaceState>> =>
      ipcRenderer.invoke('admin:workspace:claim', input),
    sync: (): Promise<ApiResult<WorkspaceState>> => ipcRenderer.invoke('admin:workspace:sync'),
    discard: (): Promise<ApiResult<WorkspaceState>> => ipcRenderer.invoke('admin:workspace:discard'),
    onChange: (listener: (state: WorkspaceState) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: WorkspaceState): void => listener(state)
      ipcRenderer.on('workspace:changed', handler)
      return () => ipcRenderer.removeListener('workspace:changed', handler)
    }
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
