import type {
  WorkspaceClaimInput,
  WorkspaceCredentialsInput,
  WorkspaceState,
  ApiResult,
  AppearanceTreatment,
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
  ChangePasswordInput,
  CreateActivationKeyInput,
  CreatedActivationKey,
  DeleteAccountInput,
  LoginAppearance,
  LoginInput,
  PublicAppearance,
  ProfileInput,
  PresentationDetail,
  PresentationSummary,
  ProjectDetail,
  ProjectGraph,
  ProjectSummary,
  RegisterInput,
  BackendConfigInput,
  BackendStatus,
  SessionUser,
  UpdateDiagnostics,
  UpdateState,
  UserSummary
} from '@shared/types'

export interface IndraBridge {
  platform: string
  versions: {
    electron: string
    chrome: string
    node: string
  }
  getAppVersion: () => Promise<string>
  appearance: {
    read: () => Promise<ApiResult<PublicAppearance>>
    video: () => Promise<ApiResult<{ bytes: Uint8Array; mime: string } | null>>
  }
  auth: {
    register: (input: RegisterInput) => Promise<ApiResult<SessionUser>>
    login: (input: LoginInput) => Promise<ApiResult<SessionUser>>
    adminLogin: (input: { identifier: string; password: string }) => Promise<ApiResult<AdminAccount | null>>
    logout: () => Promise<ApiResult<null>>
    current: () => Promise<ApiResult<SessionUser | null>>
    updateProfile: (input: ProfileInput) => Promise<ApiResult<SessionUser>>
    changePassword: (input: ChangePasswordInput) => Promise<ApiResult<null>>
    deleteAccount: (input: DeleteAccountInput) => Promise<ApiResult<null>>
  }
  users: {
    search: (input: { projectId: string; query: string }) => Promise<ApiResult<UserSummary[]>>
  }
  projects: {
    list: () => Promise<ApiResult<ProjectSummary[]>>
    create: (input: CreateProjectInput) => Promise<ApiResult<ProjectDetail>>
    get: (projectId: string) => Promise<ApiResult<ProjectDetail>>
    addMember: (input: { projectId: string; userId: string }) => Promise<ApiResult<ProjectDetail>>
    removeMember: (input: {
      projectId: string
      userId: string
    }) => Promise<ApiResult<ProjectDetail>>
  }
  documents: {
    list: (projectId: string) => Promise<ApiResult<DocumentSummary[]>>
    create: (payload: { projectId: string; title?: string }) => Promise<ApiResult<DocumentDetail>>
    get: (payload: { projectId: string; documentId: string }) => Promise<ApiResult<DocumentDetail>>
    save: (payload: {
      projectId: string
      documentId: string
      input: { blocks: unknown; title?: string; baseVersion?: number }
    }) => Promise<ApiResult<DocumentDetail>>
    rename: (payload: {
      projectId: string
      documentId: string
      title: string
    }) => Promise<ApiResult<DocumentSummary>>
    remove: (payload: { projectId: string; documentId: string }) => Promise<ApiResult<null>>
    versions: (payload: {
      projectId: string
      documentId: string
    }) => Promise<ApiResult<DocumentVersionSummary[]>>
    restore: (payload: {
      projectId: string
      documentId: string
      version: number
    }) => Promise<ApiResult<DocumentDetail>>
  }
  presentations: {
    list: (projectId: string) => Promise<ApiResult<PresentationSummary[]>>
    create: (payload: {
      projectId: string
      title?: string
    }) => Promise<ApiResult<PresentationDetail>>
    convert: (payload: {
      projectId: string
      documentId: string
    }) => Promise<ApiResult<PresentationDetail>>
    get: (payload: {
      projectId: string
      presentationId: string
    }) => Promise<ApiResult<PresentationDetail>>
    save: (payload: {
      projectId: string
      presentationId: string
      input: { title?: string; theme?: string; slides?: unknown }
    }) => Promise<ApiResult<PresentationDetail>>
    duplicate: (payload: {
      projectId: string
      presentationId: string
    }) => Promise<ApiResult<PresentationDetail>>
    remove: (payload: { projectId: string; presentationId: string }) => Promise<ApiResult<null>>
  }
  graph: {
    get: (projectId: string) => Promise<ApiResult<ProjectGraph>>
  }
  app: {
    status: () => Promise<ApiResult<AppPublicStatus>>
  }
  updates: {
    state: () => Promise<ApiResult<UpdateState>>
    check: () => Promise<ApiResult<UpdateState>>
    install: () => Promise<ApiResult<UpdateState>>
    diagnose: () => Promise<ApiResult<UpdateDiagnostics>>
    onState: (listener: (state: UpdateState) => void) => () => void
  }
  backend: {
    status: () => Promise<ApiResult<BackendStatus>>
    test: () => Promise<ApiResult<BackendStatus>>
    save: (input: BackendConfigInput) => Promise<ApiResult<BackendStatus>>
    clear: () => Promise<ApiResult<BackendStatus>>
  }
  workspace: {
    state: () => Promise<ApiResult<WorkspaceState>>
    signIn: (input: WorkspaceCredentialsInput) => Promise<ApiResult<WorkspaceState>>
    signUp: (input: WorkspaceCredentialsInput) => Promise<ApiResult<WorkspaceState>>
    signOut: () => Promise<ApiResult<WorkspaceState>>
    claim: (input: WorkspaceClaimInput) => Promise<ApiResult<WorkspaceState>>
    sync: () => Promise<ApiResult<WorkspaceState>>
    discard: () => Promise<ApiResult<WorkspaceState>>
    onChange: (listener: (state: WorkspaceState) => void) => () => void
  }
  admin: {
    status: () => Promise<ApiResult<AdminStatus>>
    setup: (input: AdminSetupInput) => Promise<ApiResult<AdminAccount>>
    login: (input: AdminLoginInput) => Promise<ApiResult<AdminAccount>>
    logout: () => Promise<ApiResult<null>>
    overview: () => Promise<ApiResult<AdminOverview>>
    suspendAccount: (payload: {
      userId: string
      suspended: boolean
    }) => Promise<ApiResult<null>>
    resetPassword: (payload: { userId: string; password: string }) => Promise<ApiResult<null>>
    deleteAccount: (userId: string) => Promise<ApiResult<null>>
    signOutAccount: (userId: string) => Promise<ApiResult<{ cleared: boolean }>>
    signOutAll: () => Promise<ApiResult<{ cleared: boolean }>>
    renameProject: (payload: { projectId: string; name: string }) => Promise<ApiResult<null>>
    transferProject: (payload: {
      projectId: string
      ownerId: string
    }) => Promise<ApiResult<null>>
    deleteProject: (projectId: string) => Promise<ApiResult<null>>
    deleteDocument: (documentId: string) => Promise<ApiResult<null>>
    deletePresentation: (presentationId: string) => Promise<ApiResult<null>>
    updateSettings: (input: AdminSettings) => Promise<ApiResult<AdminSettings>>
    createKeys: (input: CreateActivationKeyInput) => Promise<ApiResult<CreatedActivationKey[]>>
    revokeKey: (id: string) => Promise<ApiResult<null>>
    deleteKey: (id: string) => Promise<ApiResult<null>>
    changePassword: (payload: {
      currentPassword: string
      newPassword: string
    }) => Promise<ApiResult<null>>
    updateIdentity: (payload: AdminIdentityInput) => Promise<ApiResult<AdminAccount>>
    chooseLoginVideo: () => Promise<ApiResult<LoginAppearance | null>>
    removeLoginVideo: () => Promise<ApiResult<LoginAppearance>>
    updateAppearanceTreatment: (input: AppearanceTreatment) => Promise<ApiResult<LoginAppearance>>
    appearanceHealth: () => Promise<
      ApiResult<{ present: boolean; readable: boolean; bytes: number; mime: string | null }>
    >
  }
  window: {
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
    isMaximized: () => Promise<boolean>
    onMaximizedChange: (listener: (maximized: boolean) => void) => () => void
  }
}

declare global {
  interface Window {
    /** Injected by the Electron preload; undefined in a plain browser tab. */
    indra?: IndraBridge
  }
}
