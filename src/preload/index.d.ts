import type {
  AboutInfo,
  AccountCreateInput,
  AccountCredentialsInput,
  AccountSignInResult,
  AccountState,
  AdminTokenLedgerRow,
  AdminTokenAccountDetail,
  AdminTokenSnapshot,
  AdminSpendRow,
  AdminTokenSettingsInput,
  AdminPlanInput,
  AiActivity,
  AiReadiness,
  AiAnswer,
  AiAskInput,
  TokenLedgerEntry,
  TokenPlan,
  TokenSettings,
  TokensState,
  PurchaseRequest,
  PurchaseRequestInput,
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
  ConnectivityState,
  CloudPortrait,
  CloudProjectState,
  CloudProjectSummary,
  CloudPushResult,
  CloudState,
  SharedInvitation,
  SharedSyncResult,
  InvitationAnswer,
  InvitationSummary,
  LibrarySnapshot,
  OfflineWorkSummary,
  ProjectArchive,
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
  TeamDetail,
  TeamOverview,
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
  /*
   * The human identity in the cloud. `signIn` also opens the local session, so
   * the renderer does not have to sequence the two.
   */
  account: {
    state: () => Promise<ApiResult<AccountState>>
    signIn: (input: AccountCredentialsInput) => Promise<ApiResult<AccountSignInResult>>
    create: (input: AccountCreateInput) => Promise<ApiResult<AccountSignInResult>>
    createFromLocal: (password: string) => Promise<ApiResult<AccountSignInResult>>
    signOut: () => Promise<ApiResult<null>>
  }
  auth: {
    register: (input: RegisterInput) => Promise<ApiResult<SessionUser>>
    login: (input: LoginInput) => Promise<ApiResult<SessionUser>>
    adminLogin: (input: { identifier: string; password: string }) => Promise<ApiResult<AdminAccount | null>>
    logout: () => Promise<ApiResult<null>>
    current: () => Promise<ApiResult<SessionUser | null>>
    updateProfile: (input: ProfileInput) => Promise<ApiResult<SessionUser>>
    portraitBytes: (id: string) => Promise<ApiResult<{ bytes: Uint8Array; mime: string } | null>>
    choosePortrait: () => Promise<
      ApiResult<{ bytes: Uint8Array; mime: string; name: string } | null>
    >
    changePassword: (input: ChangePasswordInput) => Promise<ApiResult<null>>
    deleteAccount: (input: DeleteAccountInput) => Promise<ApiResult<null>>
  }
  users: {
    search: (input: { projectId: string; query: string }) => Promise<ApiResult<UserSummary[]>>
  }
  team: {
    read: () => Promise<ApiResult<TeamOverview>>
    create: (input: { name?: string }) => Promise<ApiResult<TeamDetail>>
    rename: (input: { name?: string }) => Promise<ApiResult<TeamDetail>>
    remove: () => Promise<ApiResult<TeamOverview>>
    invite: (ref: string) => Promise<ApiResult<TeamDetail>>
    removeMember: (userId: string) => Promise<ApiResult<TeamDetail>>
    search: (query: string) => Promise<ApiResult<UserSummary[]>>
  }

  invitations: {
    list: () => Promise<ApiResult<InvitationSummary[]>>
    accept: (invitationId: string) => Promise<ApiResult<InvitationAnswer>>
    decline: (invitationId: string) => Promise<ApiResult<InvitationAnswer>>
    cancel: (invitationId: string) => Promise<ApiResult<null>>
  }
  projects: {
    list: () => Promise<ApiResult<ProjectSummary[]>>
    create: (input: CreateProjectInput) => Promise<ApiResult<ProjectDetail>>
    get: (projectId: string) => Promise<ApiResult<ProjectDetail>>
    invite: (input: { projectId: string; userId: string }) => Promise<ApiResult<ProjectDetail>>
    removeMember: (input: {
      projectId: string
      userId: string
    }) => Promise<ApiResult<ProjectDetail>>
    exportFile: (projectId: string) => Promise<ApiResult<{ filePath: string } | null>>
    importFile: () => Promise<ApiResult<{ project: ProjectDetail; fileName: string } | null>>
    archive: (projectId: string) => Promise<ApiResult<ProjectArchive>>
    restore: (raw: string) => Promise<ApiResult<ProjectDetail>>
  }
  library: {
    snapshot: () => Promise<ApiResult<LibrarySnapshot>>
  }
  offline: {
    start: () => Promise<ApiResult<SessionUser>>
    summary: () => Promise<ApiResult<OfflineWorkSummary>>
    claim: () => Promise<ApiResult<OfflineWorkSummary>>
  }
  cloud: {
    state: () => Promise<ApiResult<CloudState>>
    project: (projectId: string) => Promise<ApiResult<CloudProjectState>>
    list: () => Promise<ApiResult<CloudProjectSummary[]>>
    push: (projectId: string) => Promise<ApiResult<CloudPushResult>>
    pull: (cloudId: string) => Promise<ApiResult<ProjectDetail>>
    key: () => Promise<ApiResult<{ code: string }>>
    adopt: (code: string) => Promise<ApiResult<CloudState>>
    forget: () => Promise<ApiResult<null>>
  }
  portrait: {
    cloud: () => Promise<ApiResult<CloudPortrait>>
  }
  share: {
    invite: (projectId: string, email: string) => Promise<ApiResult<{ id: string; pushed: boolean }>>
    inbox: () => Promise<ApiResult<SharedInvitation[]>>
    pending: (
      projectId: string
    ) => Promise<ApiResult<Array<{ id: string; email: string; createdAt: string }>>>
    answer: (
      id: string,
      cloudId: string,
      accept: boolean
    ) => Promise<ApiResult<{ accepted: boolean; project: ProjectDetail | null }>>
    cancel: (id: string) => Promise<ApiResult<null>>
    conflicts: (
      projectId: string
    ) => Promise<
      ApiResult<Array<{ id: string; kind: 'document' | 'presentation'; title: string; detectedAt: string }>>
    >
    sync: (projectId: string) => Promise<ApiResult<SharedSyncResult>>
    resolve: (conflictId: string, choice: 'cloud' | 'local') => Promise<ApiResult<ProjectDetail>>
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
    connectivity: () => Promise<ApiResult<ConnectivityState>>
    onConnectivity: (listener: (state: ConnectivityState) => void) => () => void
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
    claimAsAdmin: () => Promise<ApiResult<WorkspaceState>>
    sync: () => Promise<ApiResult<WorkspaceState>>
    discard: () => Promise<ApiResult<WorkspaceState>>
    onChange: (listener: (state: WorkspaceState) => void) => () => void
  }
  about: {
    read: () => Promise<ApiResult<AboutInfo>>
    photo: () => Promise<ApiResult<{ bytes: Uint8Array; mime: string } | null>>
    onChange: (listener: (info: AboutInfo) => void) => () => void
  }

  tokens: {
    state: (payload?: { cached?: boolean }) => Promise<ApiResult<TokensState>>
    plans: () => Promise<ApiResult<TokenPlan[]>>
    ledger: (payload?: { limit?: number }) => Promise<ApiResult<TokenLedgerEntry[]>>
    purchases: () => Promise<ApiResult<PurchaseRequest[]>>
    request: (input: PurchaseRequestInput) => Promise<ApiResult<PurchaseRequest[]>>
    cancel: (id: string) => Promise<ApiResult<PurchaseRequest[]>>
  }

  ai: {
    ask: (input: AiAskInput) => Promise<ApiResult<AiAnswer>>
    research: (input: AiAskInput) => Promise<ApiResult<AiAnswer>>
    activity: (payload?: { limit?: number }) => Promise<ApiResult<AiActivity[]>>
    readiness: () => Promise<ApiResult<AiReadiness>>
  }

  admin: {
    status: () => Promise<ApiResult<AdminStatus>>
    setup: (input: AdminSetupInput) => Promise<ApiResult<AdminAccount>>
    login: (input: AdminLoginInput) => Promise<ApiResult<AdminAccount>>
    logout: () => Promise<ApiResult<null>>
    overview: () => Promise<ApiResult<AdminOverview>>
    tokens: () => Promise<ApiResult<AdminTokenSnapshot>>
    claimTokenAdmin: () => Promise<ApiResult<AdminTokenSnapshot>>
    tokenAccount: (userId: string) => Promise<ApiResult<AdminTokenAccountDetail>>
    tokenSpend: (limit?: number) => Promise<ApiResult<AdminSpendRow[]>>
    setSuspended: (userId: string, suspended: boolean) => Promise<ApiResult<AdminTokenSnapshot>>
    resetDaily: () => Promise<ApiResult<{ refilled: number; snapshot: AdminTokenSnapshot }>>
    decidePurchase: (payload: {
      id: string
      approve: boolean
      note?: string
    }) => Promise<ApiResult<AdminTokenSnapshot>>
    setPlan: (payload: {
      userId: string
      planId: string
      days?: number
    }) => Promise<ApiResult<AdminTokenSnapshot>>
    grantTokens: (payload: {
      userId: string
      amount: number
      reason?: string
    }) => Promise<ApiResult<AdminTokenSnapshot>>
    updatePlan: (input: AdminPlanInput) => Promise<ApiResult<TokenPlan[]>>
    updateTokenSettings: (
      input: AdminTokenSettingsInput
    ) => Promise<ApiResult<TokenSettings>>
    tokenLedger: (payload: {
      userId: string
      limit?: number
    }) => Promise<ApiResult<AdminTokenLedgerRow[]>>
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
    chooseDeveloperPhoto: () => Promise<ApiResult<AboutInfo | null>>
    removeDeveloperPhoto: () => Promise<ApiResult<AboutInfo>>
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
