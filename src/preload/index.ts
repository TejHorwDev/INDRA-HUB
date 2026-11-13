import { contextBridge, ipcRenderer } from 'electron'
import type {
  AboutInfo,
  AccountCreateInput,
  AccountCredentialsInput,
  AccountSignInResult,
  AccountState,
  ApiResult,
  CreateProjectInput,
  DocumentDetail,
  DocumentSummary,
  DocumentVersionSummary,
  AdminAccount,
  AdminTokenAccountDetail,
  AdminTokenSnapshot,
  AdminSpendRow,
  AdminIdentityInput,
  AdminLoginInput,
  AdminOverview,
  AdminSettings,
  AdminSetupInput,
  AdminStatus,
  AppPublicStatus,
  AppearanceTreatment,
  ConnectivityState,
  CloudPortrait,
  CloudProjectState,
  CloudProjectSummary,
  CloudPushResult,
  CloudState,
  CloudSyncState,
  SharedInvitation,
  SharedSyncResult,
  InvitationAnswer,
  InvitationSummary,
  LibrarySnapshot,
  OfflineWorkSummary,
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
  AdminTokenLedgerRow,
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
    portraitBytes: (id: string): Promise<ApiResult<{ bytes: Uint8Array; mime: string } | null>> =>
      ipcRenderer.invoke('auth:portrait-bytes', id),
    choosePortrait: (): Promise<
      ApiResult<{ bytes: Uint8Array; mime: string; name: string } | null>
    > => ipcRenderer.invoke('auth:choose-portrait'),
    changePassword: (input: ChangePasswordInput): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('auth:change-password', input),
    deleteAccount: (input: DeleteAccountInput): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('auth:delete-account', input)
  },

  /*
   * The INDRA account — the human identity in the cloud, as opposed to the
   * local session above. Signing in resolves to the app session it opens.
   */
  account: {
    state: (): Promise<ApiResult<AccountState>> => ipcRenderer.invoke('account:state'),
    signIn: (input: AccountCredentialsInput): Promise<ApiResult<AccountSignInResult>> =>
      ipcRenderer.invoke('account:sign-in', input),
    create: (input: AccountCreateInput): Promise<ApiResult<AccountSignInResult>> =>
      ipcRenderer.invoke('account:create', input),
    createFromLocal: (password: string): Promise<ApiResult<AccountSignInResult>> =>
      ipcRenderer.invoke('account:create-from-local', password),
    signOut: (): Promise<ApiResult<null>> => ipcRenderer.invoke('account:sign-out')
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
    /** Invites one account. Joining happens when they accept. */
    invite: (ref: string): Promise<ApiResult<TeamDetail>> =>
      ipcRenderer.invoke('team:invite', ref),
    removeMember: (userId: string): Promise<ApiResult<TeamDetail>> =>
      ipcRenderer.invoke('team:remove-member', userId),
    search: (query: string): Promise<ApiResult<UserSummary[]>> =>
      ipcRenderer.invoke('team:search', query)
  },

  invitations: {
    list: (): Promise<ApiResult<InvitationSummary[]>> => ipcRenderer.invoke('invitations:list'),
    accept: (invitationId: string): Promise<ApiResult<InvitationAnswer>> =>
      ipcRenderer.invoke('invitations:accept', invitationId),
    decline: (invitationId: string): Promise<ApiResult<InvitationAnswer>> =>
      ipcRenderer.invoke('invitations:decline', invitationId),
    /** The owner takes back a question nobody has answered. */
    cancel: (invitationId: string): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('invitations:cancel', invitationId)
  },

  projects: {
    list: (): Promise<ApiResult<ProjectSummary[]>> => ipcRenderer.invoke('projects:list'),
    create: (input: CreateProjectInput): Promise<ApiResult<ProjectDetail>> =>
      ipcRenderer.invoke('projects:create', input),
    get: (projectId: string): Promise<ApiResult<ProjectDetail>> =>
      ipcRenderer.invoke('projects:get', projectId),
    invite: (input: { projectId: string; userId: string }): Promise<ApiResult<ProjectDetail>> =>
      ipcRenderer.invoke('projects:invite', input),
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

  offline: {
    /** Opens the local writing workspace. No account, no credentials, no network. */
    start: (): Promise<ApiResult<SessionUser>> => ipcRenderer.invoke('offline:start'),
    summary: (): Promise<ApiResult<OfflineWorkSummary>> => ipcRenderer.invoke('offline:summary'),
    claim: (): Promise<ApiResult<OfflineWorkSummary>> => ipcRenderer.invoke('offline:claim')
  },

  sync: {
    /** How automatic saving is doing, read from the main process. */
    state: (): Promise<ApiResult<CloudSyncState>> => ipcRenderer.invoke('sync:state'),
    /** Save everything pending now, rather than waiting for the debounce. */
    now: (): Promise<ApiResult<CloudSyncState>> => ipcRenderer.invoke('sync:now')
  },

  cloud: {
    /** Whether this PC has a cloud identity, and whether it can be used now. */
    state: (): Promise<ApiResult<CloudState>> => ipcRenderer.invoke('cloud:state'),
    /** Where one project stands, read from disk — works offline. */
    project: (projectId: string): Promise<ApiResult<CloudProjectState>> =>
      ipcRenderer.invoke('cloud:project', projectId),
    /** This PC's own cloud copies. Refused while offline. */
    list: (): Promise<ApiResult<CloudProjectSummary[]>> => ipcRenderer.invoke('cloud:list'),
    push: (projectId: string): Promise<ApiResult<CloudPushResult>> =>
      ipcRenderer.invoke('cloud:push', projectId),
    pull: (cloudId: string): Promise<ApiResult<ProjectDetail>> =>
      ipcRenderer.invoke('cloud:pull', cloudId),
    /** This PC's identity, encoded for another machine. Treat as a password. */
    key: (): Promise<ApiResult<{ code: string }>> => ipcRenderer.invoke('cloud:key'),
    adopt: (code: string): Promise<ApiResult<CloudState>> =>
      ipcRenderer.invoke('cloud:adopt', code),
    forget: (): Promise<ApiResult<null>> => ipcRenderer.invoke('cloud:forget')
  },

  portrait: {
    /** Where the workspace keeps this account's picture, and whether it does. */
    cloud: (): Promise<ApiResult<CloudPortrait>> => ipcRenderer.invoke('portrait:cloud')
  },

  /*
   * One project, two PCs: an invitation addressed to an email, answered on the
   * other machine, and an explicit sync that reports what it could not settle.
   */
  share: {
    invite: (projectId: string, email: string): Promise<ApiResult<{ id: string; pushed: boolean }>> =>
      ipcRenderer.invoke('share:invite', projectId, email),
    inbox: (): Promise<ApiResult<SharedInvitation[]>> => ipcRenderer.invoke('share:inbox'),
    pending: (
      projectId: string
    ): Promise<ApiResult<Array<{ id: string; email: string; createdAt: string }>>> =>
      ipcRenderer.invoke('share:pending', projectId),
    answer: (
      id: string,
      cloudId: string,
      accept: boolean
    ): Promise<ApiResult<{ accepted: boolean; project: ProjectDetail | null }>> =>
      ipcRenderer.invoke('share:answer', id, cloudId, accept),
    cancel: (id: string): Promise<ApiResult<null>> => ipcRenderer.invoke('share:cancel', id),
    conflicts: (
      projectId: string
    ): Promise<ApiResult<Array<{ id: string; kind: 'document' | 'presentation'; title: string; detectedAt: string }>>> =>
      ipcRenderer.invoke('share:conflicts', projectId),
    sync: (projectId: string): Promise<ApiResult<SharedSyncResult>> =>
      ipcRenderer.invoke('share:sync', projectId),
    resolve: (conflictId: string, choice: 'cloud' | 'local'): Promise<ApiResult<ProjectDetail>> =>
      ipcRenderer.invoke('share:resolve', conflictId, choice)
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

  /*
   * Tokens and AI. Every one of these is answered by the main process; the
   * renderer holds no token and cannot charge anything.
   */
  about: {
    read: (): Promise<ApiResult<AboutInfo>> => ipcRenderer.invoke('about:read'),
    /** The portrait as bytes, turned into a Blob URL by the renderer. */
    photo: (): Promise<ApiResult<{ bytes: Uint8Array; mime: string } | null>> =>
      ipcRenderer.invoke('about:photo'),
    /*
     * The portrait can arrive from another machine while this window is open.
     * The main process re-reads it and pushes the result, so the card never
     * needs to poll to notice.
     */
    onChange: (listener: (info: AboutInfo) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, info: AboutInfo): void => listener(info)
      ipcRenderer.on('about:changed', handler)
      return () => ipcRenderer.removeListener('about:changed', handler)
    }
  },

  tokens: {
    state: (payload?: { cached?: boolean }): Promise<ApiResult<TokensState>> =>
      ipcRenderer.invoke('tokens:state', payload ?? {}),
    plans: (): Promise<ApiResult<TokenPlan[]>> => ipcRenderer.invoke('tokens:plans'),
    ledger: (payload?: { limit?: number }): Promise<ApiResult<TokenLedgerEntry[]>> =>
      ipcRenderer.invoke('tokens:ledger', payload ?? {}),
    purchases: (): Promise<ApiResult<PurchaseRequest[]>> => ipcRenderer.invoke('tokens:purchases'),
    request: (input: PurchaseRequestInput): Promise<ApiResult<PurchaseRequest[]>> =>
      ipcRenderer.invoke('tokens:request', input),
    cancel: (id: string): Promise<ApiResult<PurchaseRequest[]>> =>
      ipcRenderer.invoke('tokens:cancel', id)
  },

  ai: {
    /** One turn inside a document: write, rewrite, answer. */
    ask: (input: AiAskInput): Promise<ApiResult<AiAnswer>> => ipcRenderer.invoke('ai:ask', input),
    /** Plan, search, read, and write a brief with the sources it used. */
    research: (input: AiAskInput): Promise<ApiResult<AiAnswer>> =>
      ipcRenderer.invoke('ai:research', input),
    /** What this PC asked for, so a document can point at it later. */
    activity: (payload?: { limit?: number }): Promise<ApiResult<AiActivity[]>> =>
      ipcRenderer.invoke('ai:activity', payload ?? {}),
    /** Whether the workspace holds a model key, so a run can actually start. */
    readiness: (): Promise<ApiResult<AiReadiness>> => ipcRenderer.invoke('ai:readiness')
  },

  admin: {
    status: (): Promise<ApiResult<AdminStatus>> => ipcRenderer.invoke('admin:status'),
    setup: (input: AdminSetupInput): Promise<ApiResult<AdminAccount>> =>
      ipcRenderer.invoke('admin:setup', input),
    login: (input: AdminLoginInput): Promise<ApiResult<AdminAccount>> =>
      ipcRenderer.invoke('admin:login', input),
    logout: (): Promise<ApiResult<null>> => ipcRenderer.invoke('admin:logout'),
    overview: (): Promise<ApiResult<AdminOverview>> => ipcRenderer.invoke('admin:overview'),
    tokens: (): Promise<ApiResult<AdminTokenSnapshot>> =>
      ipcRenderer.invoke('admin:tokens:snapshot'),
    /** Takes the server's token-administrator role, once, for this installation. */
    claimTokenAdmin: (): Promise<ApiResult<AdminTokenSnapshot>> =>
      ipcRenderer.invoke('admin:tokens:claim'),
    tokenAccount: (userId: string): Promise<ApiResult<AdminTokenAccountDetail>> =>
      ipcRenderer.invoke('admin:tokens:account', { userId }),
    tokenSpend: (limit?: number): Promise<ApiResult<AdminSpendRow[]>> =>
      ipcRenderer.invoke('admin:tokens:spend', { limit }),
    setSuspended: (userId: string, suspended: boolean): Promise<ApiResult<AdminTokenSnapshot>> =>
      ipcRenderer.invoke('admin:tokens:suspend', { userId, suspended }),
    resetDaily: (): Promise<ApiResult<{ refilled: number; snapshot: AdminTokenSnapshot }>> =>
      ipcRenderer.invoke('admin:tokens:resetDaily'),
    decidePurchase: (payload: {
      id: string
      approve: boolean
      note?: string
    }): Promise<ApiResult<AdminTokenSnapshot>> =>
      ipcRenderer.invoke('admin:tokens:decide', payload),
    setPlan: (payload: {
      userId: string
      planId: string
      days?: number
    }): Promise<ApiResult<AdminTokenSnapshot>> =>
      ipcRenderer.invoke('admin:tokens:setPlan', payload),
    grantTokens: (payload: {
      userId: string
      amount: number
      reason?: string
    }): Promise<ApiResult<AdminTokenSnapshot>> =>
      ipcRenderer.invoke('admin:tokens:grant', payload),
    updatePlan: (input: AdminPlanInput): Promise<ApiResult<TokenPlan[]>> =>
      ipcRenderer.invoke('admin:tokens:updatePlan', input),
    updateTokenSettings: (
      input: AdminTokenSettingsInput
    ): Promise<ApiResult<TokenSettings>> =>
      ipcRenderer.invoke('admin:tokens:settings', input),
    tokenLedger: (payload: {
      userId: string
      limit?: number
    }): Promise<ApiResult<AdminTokenLedgerRow[]>> =>
      ipcRenderer.invoke('admin:tokens:ledger', payload),
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
    chooseDeveloperPhoto: (): Promise<ApiResult<AboutInfo | null>> =>
      ipcRenderer.invoke('admin:about:photo:choose'),
    removeDeveloperPhoto: (): Promise<ApiResult<AboutInfo>> =>
      ipcRenderer.invoke('admin:about:photo:remove'),
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
    /** Hands an unclaimed workspace to the signed-in account, as this PC's administrator. */
    claimAsAdmin: (): Promise<ApiResult<WorkspaceState>> =>
      ipcRenderer.invoke('admin:workspace:claim-as-admin'),
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
