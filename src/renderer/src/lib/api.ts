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
  ChangePasswordInput,
  CreateActivationKeyInput,
  CreateProjectInput,
  CreatedActivationKey,
  DeleteAccountInput,
  DocumentDetail,
  DocumentSummary,
  DocumentVersionSummary,
  ErrorCode,
  LoginInput,
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
  UpdateState,
  UserSummary
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
  auth: {
    current: (): Promise<SessionUser | null> => unwrap(bridge().auth.current()),
    signIn: (input: LoginInput): Promise<SessionUser> => unwrap(bridge().auth.login(input)),
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
      unwrap(bridge().projects.removeMember(input))
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
    status: (): Promise<AppPublicStatus> => unwrap(bridge().app.status())
  },
  updates: {
    state: (): Promise<UpdateState> => unwrap(bridge().updates.state()),
    check: (): Promise<UpdateState> => unwrap(bridge().updates.check()),
    install: (): Promise<UpdateState> => unwrap(bridge().updates.install()),
    /** Live progress pushes from the main process. Returns an unsubscribe. */
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
      unwrap(bridge().admin.updateIdentity(input))
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
