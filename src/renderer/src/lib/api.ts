import type {
  AdminAccount,
  AdminIdentityInput,
  AdminLoginInput,
  AdminOverview,
  AdminSettings,
  AdminSetupInput,
  AdminStatus,
  ApiResult,
  AppPublicStatus,
  AppearanceTreatment,
  ConnectivityState,
  CloudProjectState,
  CloudProjectSummary,
  CloudPushResult,
  CloudState,
  LibrarySnapshot,
  OfflineWorkSummary,
  ProjectArchive,
  ChangePasswordInput,
  CreateActivationKeyInput,
  CreateProjectInput,
  CreatedActivationKey,
  DeleteAccountInput,
  DocumentDetail,
  DocumentSummary,
  DocumentVersionSummary,
  ErrorCode,
  LoginAppearance,
  LoginInput,
  PublicAppearance,
  PresentationDetail,
  PresentationSummary,
  ProfileInput,
  ProjectDetail,
  ProjectGraph,
  ProjectSummary,
  RegisterInput,
  BackendConfigInput,
  BackendStatus,
  SessionUser,
  TeamDetail,
  TeamOverview,
  UpdateDiagnostics,
  UpdateState,
  UserSummary,
  WorkspaceClaimInput,
  WorkspaceCredentialsInput,
  WorkspaceState
} from '@shared/types'

/** A typed failure coming from the main process. */
export class ApiError extends Error {
  readonly code: ErrorCode
  readonly field?: string

  constructor(code: ErrorCode, message: string, field?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.field = field
  }
}

function bridge(): NonNullable<Window['indra']> {
  const api = window.indra
  if (!api) throw new ApiError('UNKNOWN', 'The desktop bridge is unavailable.')
  return api
}

async function unwrap<T>(promise: Promise<ApiResult<T>>): Promise<T> {
  let result: ApiResult<T>
  try {
    result = await promise
  } catch {
    throw new ApiError('UNKNOWN', 'The desktop bridge is unavailable.')
  }
  if (!result.ok) throw new ApiError(result.code, result.message, result.field)
  return result.data
}

export const api = {
  team: {
    read: (): Promise<TeamOverview> => unwrap(bridge().team.read()),
    create: (input: { name?: string }): Promise<TeamDetail> => unwrap(bridge().team.create(input)),
    rename: (input: { name?: string }): Promise<TeamDetail> => unwrap(bridge().team.rename(input)),
    remove: (): Promise<TeamOverview> => unwrap(bridge().team.remove()),
    addMember: (userId: string): Promise<TeamDetail> => unwrap(bridge().team.addMember(userId)),
    removeMember: (userId: string): Promise<TeamDetail> =>
      unwrap(bridge().team.removeMember(userId)),
    search: (query: string): Promise<UserSummary[]> => unwrap(bridge().team.search(query))
  },

  auth: {
    current: (): Promise<SessionUser | null> => unwrap(bridge().auth.current()),
    signIn: (input: LoginInput): Promise<SessionUser> => unwrap(bridge().auth.login(input)),
    /**
     * The administrator signing in on the ordinary screen. Resolves to null for
     * anyone else, which is indistinguishable from a wrong password.
     */
    signInAdmin: (input: { identifier: string; password: string }): Promise<AdminAccount | null> =>
      unwrap(bridge().auth.adminLogin(input)),
    signUp: (input: RegisterInput): Promise<SessionUser> => unwrap(bridge().auth.register(input)),
    signOut: (): Promise<null> => unwrap(bridge().auth.logout()),
    updateProfile: (input: ProfileInput): Promise<SessionUser> =>
      unwrap(bridge().auth.updateProfile(input)),
    changePassword: (input: ChangePasswordInput): Promise<null> =>
      unwrap(bridge().auth.changePassword(input)),
    deleteAccount: (input: DeleteAccountInput): Promise<null> =>
      unwrap(bridge().auth.deleteAccount(input))
  },
  projects: {
    list: (): Promise<ProjectSummary[]> => unwrap(bridge().projects.list()),
    create: (input: CreateProjectInput): Promise<ProjectDetail> =>
      unwrap(bridge().projects.create(input)),
    get: (projectId: string): Promise<ProjectDetail> => unwrap(bridge().projects.get(projectId)),
    addMember: (input: { projectId: string; userId: string }): Promise<ProjectDetail> =>
      unwrap(bridge().projects.addMember(input)),
    removeMember: (input: { projectId: string; userId: string }): Promise<ProjectDetail> =>
      unwrap(bridge().projects.removeMember(input)),
    exportFile: (projectId: string): Promise<{ filePath: string } | null> =>
      unwrap(bridge().projects.exportFile(projectId)),
    importFile: (): Promise<{ project: ProjectDetail; fileName: string } | null> =>
      unwrap(bridge().projects.importFile()),
    archive: (projectId: string): Promise<ProjectArchive> =>
      unwrap(bridge().projects.archive(projectId)),
    restore: (raw: string): Promise<ProjectDetail> => unwrap(bridge().projects.restore(raw))
  },

  library: {
    snapshot: (): Promise<LibrarySnapshot> => unwrap(bridge().library.snapshot())
  },

  offline: {
    start: (): Promise<SessionUser> => unwrap(bridge().offline.start()),
    summary: (): Promise<OfflineWorkSummary> => unwrap(bridge().offline.summary()),
    claim: (): Promise<OfflineWorkSummary> => unwrap(bridge().offline.claim())
  },

  /*
   * The cloud copy. `project()` reads timestamps from disk and is safe to call
   * offline; everything else is refused by the main process with no route out,
   * so a screen never has to guess whether the cloud is reachable.
   */
  cloud: {
    state: (): Promise<CloudState> => unwrap(bridge().cloud.state()),
    project: (projectId: string): Promise<CloudProjectState> =>
      unwrap(bridge().cloud.project(projectId)),
    list: (): Promise<CloudProjectSummary[]> => unwrap(bridge().cloud.list()),
    push: (projectId: string): Promise<CloudPushResult> => unwrap(bridge().cloud.push(projectId)),
    pull: (cloudId: string): Promise<ProjectDetail> => unwrap(bridge().cloud.pull(cloudId)),
    /** This PC's cloud identity, to carry to another machine. */
    key: (): Promise<{ code: string }> => unwrap(bridge().cloud.key()),
    adopt: (code: string): Promise<CloudState> => unwrap(bridge().cloud.adopt(code)),
    forget: (): Promise<null> => unwrap(bridge().cloud.forget())
  },
  users: {
    search: (input: { projectId: string; query: string }): Promise<UserSummary[]> =>
      unwrap(bridge().users.search(input))
  },
  documents: {
    list: (projectId: string): Promise<DocumentSummary[]> =>
      unwrap(bridge().documents.list(projectId)),
    create: (projectId: string, title?: string): Promise<DocumentDetail> =>
      unwrap(bridge().documents.create({ projectId, title })),
    get: (projectId: string, documentId: string): Promise<DocumentDetail> =>
      unwrap(bridge().documents.get({ projectId, documentId })),
    save: (
      projectId: string,
      documentId: string,
      input: { blocks: unknown; title?: string; baseVersion?: number }
    ): Promise<DocumentDetail> =>
      unwrap(bridge().documents.save({ projectId, documentId, input })),
    rename: (projectId: string, documentId: string, title: string): Promise<DocumentSummary> =>
      unwrap(bridge().documents.rename({ projectId, documentId, title })),
    remove: (projectId: string, documentId: string): Promise<null> =>
      unwrap(bridge().documents.remove({ projectId, documentId })),
    versions: (projectId: string, documentId: string): Promise<DocumentVersionSummary[]> =>
      unwrap(bridge().documents.versions({ projectId, documentId })),
    restore: (projectId: string, documentId: string, version: number): Promise<DocumentDetail> =>
      unwrap(bridge().documents.restore({ projectId, documentId, version }))
  },
  presentations: {
    list: (projectId: string): Promise<PresentationSummary[]> =>
      unwrap(bridge().presentations.list(projectId)),
    create: (projectId: string, title?: string): Promise<PresentationDetail> =>
      unwrap(bridge().presentations.create({ projectId, title })),
    convert: (projectId: string, documentId: string): Promise<PresentationDetail> =>
      unwrap(bridge().presentations.convert({ projectId, documentId })),
    get: (projectId: string, presentationId: string): Promise<PresentationDetail> =>
      unwrap(bridge().presentations.get({ projectId, presentationId })),
    save: (
      projectId: string,
      presentationId: string,
      input: { title?: string; theme?: string; slides?: unknown }
    ): Promise<PresentationDetail> =>
      unwrap(bridge().presentations.save({ projectId, presentationId, input })),
    duplicate: (projectId: string, presentationId: string): Promise<PresentationDetail> =>
      unwrap(bridge().presentations.duplicate({ projectId, presentationId })),
    remove: (projectId: string, presentationId: string): Promise<null> =>
      unwrap(bridge().presentations.remove({ projectId, presentationId }))
  },
  graph: {
    get: (projectId: string): Promise<ProjectGraph> => unwrap(bridge().graph.get(projectId))
  },
  app: {
    status: (): Promise<AppPublicStatus> => unwrap(bridge().app.status()),
    connectivity: (): Promise<ConnectivityState> => unwrap(bridge().app.connectivity()),
    onConnectivity: (listener: (state: ConnectivityState) => void): (() => void) =>
      bridge().app.onConnectivity(listener)
  },
  updates: {
    state: (): Promise<UpdateState> => unwrap(bridge().updates.state()),
    check: (): Promise<UpdateState> => unwrap(bridge().updates.check()),
    install: (): Promise<UpdateState> => unwrap(bridge().updates.install()),
    /** Live progress pushes from the main process. Returns an unsubscribe. */
    diagnose: (): Promise<UpdateDiagnostics> => unwrap(bridge().updates.diagnose()),
    onState: (listener: (state: UpdateState) => void): (() => void) =>
      bridge().updates.onState(listener)
  },
  backend: {
    status: (): Promise<BackendStatus> => unwrap(bridge().backend.status()),
    test: (): Promise<BackendStatus> => unwrap(bridge().backend.test()),
    save: (input: BackendConfigInput): Promise<BackendStatus> =>
      unwrap(bridge().backend.save(input)),
    clear: (): Promise<BackendStatus> => unwrap(bridge().backend.clear())
  },
  appearance: {
    read: (): Promise<PublicAppearance> => unwrap(bridge().appearance.read()),
    video: (): Promise<{ bytes: Uint8Array; mime: string } | null> =>
      unwrap(bridge().appearance.video())
  },

  admin: {
    status: (): Promise<AdminStatus> => unwrap(bridge().admin.status()),
    setup: (input: AdminSetupInput): Promise<AdminAccount> => unwrap(bridge().admin.setup(input)),
    signIn: (input: AdminLoginInput): Promise<AdminAccount> => unwrap(bridge().admin.login(input)),
    signOut: (): Promise<null> => unwrap(bridge().admin.logout()),
    overview: (): Promise<AdminOverview> => unwrap(bridge().admin.overview()),
    suspendAccount: (userId: string, suspended: boolean): Promise<null> =>
      unwrap(bridge().admin.suspendAccount({ userId, suspended })),
    resetPassword: (userId: string, password: string): Promise<null> =>
      unwrap(bridge().admin.resetPassword({ userId, password })),
    deleteAccount: (userId: string): Promise<null> =>
      unwrap(bridge().admin.deleteAccount(userId)),
    signOutAccount: (userId: string): Promise<{ cleared: boolean }> =>
      unwrap(bridge().admin.signOutAccount(userId)),
    signOutAll: (): Promise<{ cleared: boolean }> => unwrap(bridge().admin.signOutAll()),
    renameProject: (projectId: string, name: string): Promise<null> =>
      unwrap(bridge().admin.renameProject({ projectId, name })),
    transferProject: (projectId: string, ownerId: string): Promise<null> =>
      unwrap(bridge().admin.transferProject({ projectId, ownerId })),
    deleteProject: (projectId: string): Promise<null> =>
      unwrap(bridge().admin.deleteProject(projectId)),
    deleteDocument: (documentId: string): Promise<null> =>
      unwrap(bridge().admin.deleteDocument(documentId)),
    deletePresentation: (presentationId: string): Promise<null> =>
      unwrap(bridge().admin.deletePresentation(presentationId)),
    updateSettings: (input: AdminSettings): Promise<AdminSettings> =>
      unwrap(bridge().admin.updateSettings(input)),
    createKeys: (input: CreateActivationKeyInput): Promise<CreatedActivationKey[]> =>
      unwrap(bridge().admin.createKeys(input)),
    revokeKey: (id: string): Promise<null> => unwrap(bridge().admin.revokeKey(id)),
    deleteKey: (id: string): Promise<null> => unwrap(bridge().admin.deleteKey(id)),
    changePassword: (currentPassword: string, newPassword: string): Promise<null> =>
      unwrap(bridge().admin.changePassword({ currentPassword, newPassword })),
    updateIdentity: (input: AdminIdentityInput): Promise<AdminAccount> =>
      unwrap(bridge().admin.updateIdentity(input)),
    chooseLoginVideo: (): Promise<LoginAppearance | null> =>
      unwrap(bridge().admin.chooseLoginVideo()),
    removeLoginVideo: (): Promise<LoginAppearance> => unwrap(bridge().admin.removeLoginVideo()),
    updateAppearanceTreatment: (input: AppearanceTreatment): Promise<LoginAppearance> =>
      unwrap(bridge().admin.updateAppearanceTreatment(input)),
    appearanceHealth: (): Promise<{
      present: boolean
      readable: boolean
      bytes: number
      mime: string | null
    }> => unwrap(bridge().admin.appearanceHealth())
  },

  workspace: {
    state: (): Promise<WorkspaceState> => unwrap(bridge().workspace.state()),
    signIn: (input: WorkspaceCredentialsInput): Promise<WorkspaceState> =>
      unwrap(bridge().workspace.signIn(input)),
    signUp: (input: WorkspaceCredentialsInput): Promise<WorkspaceState> =>
      unwrap(bridge().workspace.signUp(input)),
    signOut: (): Promise<WorkspaceState> => unwrap(bridge().workspace.signOut()),
    claim: (input: WorkspaceClaimInput): Promise<WorkspaceState> => unwrap(bridge().workspace.claim(input)),
    sync: (): Promise<WorkspaceState> => unwrap(bridge().workspace.sync()),
    discard: (): Promise<WorkspaceState> => unwrap(bridge().workspace.discard()),
    onChange: (listener: (state: WorkspaceState) => void): (() => void) =>
      bridge().workspace.onChange(listener)
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong. Please try again.'
}

export function errorCode(error: unknown): ErrorCode | null {
  return error instanceof ApiError ? error.code : null
}
