/**
 * Contracts shared by the main process, the preload bridge and the renderer.
 * The main process owns the data; the renderer only ever sees these shapes.
 */

export type ThemeMode = 'light' | 'dark'

/* ---------------- errors ---------------- */

export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_CREDENTIALS'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'DUPLICATE_MEMBER'
  | 'ADMIN_REQUIRED'
  | 'THROTTLED'
  | 'ACCOUNT_SUSPENDED'
  | 'MAINTENANCE'
  | 'REGISTRATION_CLOSED'
  /* The balance ran out, or the run was refused because it would have. */
  | 'INSUFFICIENT_CREDITS'
  /* AI could not run: not switched on, no route out, or the model refused. */
  | 'AI_UNAVAILABLE'
  | 'UNKNOWN'

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string; field?: string }

/* ---------------- accounts ---------------- */

/** The signed-in account. Never contains password material. */
export interface SessionUser {
  id: string
  username: string
  displayName: string
  email: string
  createdAt: string
  lastSignInAt: string | null
  /**
   * 'offline' is the local writing workspace: no account, no credentials, no
   * network. It owns work the same way an account does, so it can be adopted.
   */
  mode?: 'account' | 'offline'
}

/** What is sitting in the offline workspace, waiting to be adopted. */
export interface OfflineWorkSummary {
  projects: number
  documents: number
  presentations: number
}

/**
 * A team is the small group of people who work together in this installation.
 * One per owner; the roster is the people they have added.
 */
export type TeamRole = 'owner' | 'member'

export interface TeamMember {
  id: string
  username: string
  displayName: string
  role: TeamRole
  joinedAt: string
}

export interface TeamDetail {
  id: string
  name: string
  ownerId: string
  ownerName: string
  createdAt: string
  /** The signed-in user's relationship to this team. */
  role: TeamRole
  memberCount: number
  /** The owner first, then everyone else by name. */
  members: TeamMember[]
  /** People asked and not yet answered. Only the owner sees these. */
  invitations: InvitationSummary[]
}

/**
 * A request to join a team or a project, waiting for an answer.
 *
 * Adding somebody is not the same as them joining: the person on the other end
 * is told, and can say no. Until they accept, the roster shows them as invited
 * and nothing of theirs is shared.
 */
export interface InvitationSummary {
  id: string
  kind: 'team' | 'project'
  targetId: string
  /** Team name, or project name, whichever the invitation is for. */
  targetName: string
  personId: string
  displayName: string
  email: string
  invitedByName: string
  createdAt: string
}

/** What a screen gets back once an invitation has been answered. */
export interface InvitationAnswer {
  kind: 'team' | 'project'
  targetId: string
  targetName: string
  accepted: boolean
}

/** What the home screen needs: the team you own, and any you merely belong to. */
export interface TeamOverview {
  owned: TeamDetail | null
  memberOf: TeamDetail[]
}

/** Public projection used by member lists and search. */
export interface UserSummary {
  id: string
  username: string
  displayName: string
  /**
   * Present only when the person was found by their email address — the one
   * search that is allowed to reach an account, because names collide.
   */
  email?: string
}

export interface RegisterInput {
  username: string
  displayName: string
  email: string
  password: string
  /** Required only while the administrator requires activation keys. */
  activationKey?: string
}

export interface ProfileInput {
  displayName: string
  email: string
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

export interface DeleteAccountInput {
  password: string
}

export interface LoginInput {
  identifier: string
  password: string
}

/* ---------------- projects ---------------- */

/** Ownership and membership stay separate: the owner has no member row. */
export type ProjectRole = 'owner' | 'member'

export interface ProjectMember {
  userId: string
  username: string
  displayName: string
  role: 'member'
  /**
   * How they can open this project: an invitation they accepted, or the head
   * developer's team. The distinction is shown, because "on the team" and
   * "invited to this project" are different promises and only one of them can
   * be taken away row by row.
   */
  via: 'invite' | 'team'
  joinedAt: string
}

/** What the operating system says about the machine's route to the internet. */
export interface ConnectivityState {
  online: boolean
  /** When the current answer was established. */
  since: string
}

/**
 * A document or a presentation seen outside its project — the offline
 * library, where the work of every local project is listed in one place.
 */
export interface LibraryItem {
  id: string
  projectId: string
  projectName: string
  title: string
  createdAt: string
  updatedAt: string
  /** Slides for a presentation; absent for a document. */
  slideCount?: number
}

export interface LibrarySnapshot {
  documents: LibraryItem[]
  presentations: LibraryItem[]
}

/* ---------------- the cloud copy ---------------- */

/**
 * What this installation knows about its cloud identity. The address is a
 * generated one owned by this machine — the app never asks for, or shows, a
 * password — and it is only ever masked here.
 */
export interface CloudState {
  /** False when no cloud endpoint is configured in the build. */
  available: boolean
  /** True once this machine has an identity in the cloud. */
  linked: boolean
  /** Masked address, for recognising the copy; never a credential. */
  account: string | null
  /** Online is decided by the main process, not by the renderer. */
  online: boolean
  /** Why the cloud is not usable, in plain words, when it is not. */
  message: string | null
}

/** A project that exists in this installation's own cloud copy. */
export interface CloudProjectSummary {
  cloudId: string
  name: string
  description: string
  updatedAt: string
  /** The local project this copy came from or was pushed to, when known. */
  localProjectId: string | null
  /** Who owns it, for a copy that was shared with this account. */
  ownerName?: string | null
  /** False when somebody else's project is shared with this account. */
  isOwner?: boolean
}

/** How one local project relates to the cloud. Read from disk, never the network. */
export interface CloudProjectState {
  projectId: string
  cloudId: string | null
  pushedAt: string | null
  documents: number
  presentations: number
  /** True when local work has changed since the last push. */
  stale: boolean
  /** True when this project also lives on somebody else's PC. */
  shared: boolean
  role: 'owner' | 'member'
  /** The head developer's name, for a project shared with this account. */
  ownerName: string | null
  /** When this PC last agreed with the other one. */
  lastSyncAt: string | null
  /** Items changed on both PCs, waiting for a decision. */
  conflicts: number
}

/** Somebody on another PC asking to be let into a project. */
export interface SharedInvitation {
  id: string
  cloudId: string
  projectName: string
  invitedByName: string
  createdAt: string
}

/** An item changed on both PCs, waiting to be answered. */
export interface CloudConflict {
  id: string
  kind: 'document' | 'presentation'
  title: string
  detectedAt: string
}

/** What one pass of the shared project did. */
export interface SharedSyncResult {
  projectId: string
  cloudId: string
  pulled: number
  pushed: number
  syncedAt: string
  /** Changed on both sides: nothing was written, somebody has to choose. */
  conflicts: Array<{ kind: 'document' | 'presentation'; title: string }>
}

export interface CloudPushResult {
  cloudId: string
  pushedAt: string
  documents: number
  presentations: number
}

/** What a saved project file contains. Written by the app, read by it. */
export interface ProjectArchive {
  format: 'indrahub.project'
  version: 1
  exportedAt: string
  project: { name: string; description: string }
  documents: {
    title: string
    blocks: unknown
    createdAt: string
    updatedAt: string
  }[]
  presentations: {
    title: string
    theme: string
    slides: unknown
    createdAt: string
    updatedAt: string
  }[]
}

export interface ProjectSummary {
  id: string
  name: string
  description: string
  ownerId: string
  ownerName: string
  createdAt: string
  updatedAt: string
  /** Everyone with access, the owner aside. */
  memberCount: number
  /** The signed-in user's relationship to this project. */
  role: ProjectRole
  /** How this account reaches the project: owns it, invited, or on the team. */
  via: 'owner' | 'invite' | 'team'
}

/** The head developer's team, and how many people are standing in it. */
export interface ProjectTeam {
  id: string
  name: string
  memberCount: number
}

export interface ProjectDetail extends ProjectSummary {
  owner: UserSummary
  members: ProjectMember[]
  /**
   * The head developer's team, when they have one. Everyone on it can already
   * open this project, which the screen says out loud rather than leaving the
   * access rule to be discovered.
   */
  team: ProjectTeam | null
  /** People asked and not yet answered. Only the head developer sees these. */
  invitations: InvitationSummary[]
}

export interface CreateProjectInput {
  name: string
  description?: string
}

/* ---------------- documents ---------------- */

/**
 * A document is an ordered list of typed blocks. Headings carry the structure
 * the conversion engine reads; paragraph/list/table blocks carry HTML that the
 * editor produced.
 */
export type DocBlockType =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'paragraph'
  | 'bulleted'
  | 'numbered'
  | 'quote'
  | 'code'
  | 'divider'
  | 'table'
  | 'image'

export interface DocBlock {
  id: string
  type: DocBlockType
  /** Inline HTML for text blocks (bold, italic, links…). */
  html?: string
  /** Table rows, first row is the header. */
  rows?: string[][]
  src?: string
  alt?: string
}

export interface DocumentSummary {
  id: string
  projectId: string
  title: string
  version: number
  createdBy: UserSummary
  updatedBy: UserSummary | null
  createdAt: string
  updatedAt: string
}

export interface DocumentDetail extends DocumentSummary {
  blocks: DocBlock[]
}

export interface DocumentVersionSummary {
  version: number
  title: string
  editor: UserSummary | null
  createdAt: string
}

/* ---------------- presentations ---------------- */

export type SlideLayout =
  | 'title'
  | 'section'
  | 'text'
  | 'bullets'
  | 'process'
  | 'quote'
  | 'table'
  | 'image'
  | 'closing'

export interface SlideTable {
  headers: string[]
  rows: string[][]
}

export interface Slide {
  id: string
  layout: SlideLayout
  title: string
  body?: string
  bullets?: string[]
  quote?: string
  table?: SlideTable
  image?: { src: string; alt: string }
  notes: string
}

export const PRESENTATION_THEMES = [
  'minimal',
  'academic',
  'corporate',
  'editorial',
  'research',
  'dark'
] as const

export type PresentationTheme = (typeof PRESENTATION_THEMES)[number]

/** `blank` is user-authored, `rule` is the offline converter, `ai` is enhanced. */
export type ConversionMode = 'blank' | 'rule' | 'ai'

export interface PresentationSummary {
  id: string
  projectId: string
  title: string
  theme: PresentationTheme
  conversionMode: ConversionMode
  sourceDocumentId: string | null
  sourceDocumentTitle: string | null
  sourceDocumentVersion: number | null
  slideCount: number
  createdBy: UserSummary
  createdAt: string
  updatedAt: string
  /** True when the source document moved on after this was generated. */
  stale: boolean
}

export interface PresentationDetail extends PresentationSummary {
  slides: Slide[]
}

/* ---------------- administration ---------------- */

/**
 * Admin identity is deliberately separate from ordinary accounts: it lives in
 * its own table with its own session, and only the overview below is ever
 * returned to an admin screen.
 */
/** Changing the administrator's own sign-in identity, confirmed with a password. */
export interface AdminIdentityInput {
  email: string
  displayName: string
  currentPassword: string
}

export interface AdminAccount {
  id: string
  email: string
  displayName: string
  createdAt: string
  lastSignInAt: string | null
}

export interface AdminStatus {
  /** False until the one admin account has been created on this machine. */
  configured: boolean
  signedIn: boolean
  admin: AdminAccount | null
}

export interface AdminSetupInput {
  email: string
  displayName: string
  password: string
  confirmPassword: string
}

export interface AdminLoginInput {
  email: string
  password: string
}

export interface AdminAccountRow {
  id: string
  username: string
  displayName: string
  email: string
  createdAt: string
  ownedProjects: number
  memberships: number
  documentCount: number
  presentationCount: number
  suspendedAt: string | null
}

export interface AdminProjectRow {
  id: string
  name: string
  description: string
  ownerId: string
  ownerName: string
  ownerEmail: string
  memberCount: number
  documentCount: number
  presentationCount: number
  createdAt: string
  updatedAt: string
}

export interface AdminContentRow {
  id: string
  kind: 'document' | 'presentation'
  title: string
  projectId: string
  projectName: string
  authorName: string
  /** Document version, or slide count for a presentation. */
  units: number
  updatedAt: string
}

export type AdminAuditAction =
  | 'setup'
  | 'sign_in'
  | 'sign_out'
  | 'sign_in_failed'
  | 'password_changed'
  | 'identity_changed'
  | 'account_suspended'
  | 'account_restored'
  | 'account_deleted'
  | 'password_reset'
  | 'account_signed_out'
  | 'sessions_cleared'
  | 'project_renamed'
  | 'project_transferred'
  | 'project_deleted'
  | 'document_deleted'
  | 'presentation_deleted'
  | 'settings_updated'
  | 'keys_created'
  | 'key_revoked'
  | 'key_deleted'
  | 'appearance_updated'
  | 'appearance_removed'

export interface AdminAuditEntry {
  id: string
  action: AdminAuditAction
  detail: string
  adminEmail: string | null
  createdAt: string
}

/** App-wide switches the administrator owns; enforced in the main process. */
export interface AdminSettings {
  allowRegistration: boolean
  maintenanceMode: boolean
  maintenanceMessage: string
  /** When on, registration consumes a locally generated activation key. */
  requireActivationKey: boolean
}

/** The subset every renderer needs, including signed-out screens. */
export interface AppPublicStatus {
  maintenanceMode: boolean
  maintenanceMessage: string
  allowRegistration: boolean
  requireActivationKey: boolean
  /**
   * False only on a fresh installation. Signed-out screens use it to offer the
   * one-time administrator setup; afterwards the entry point is hidden from
   * ordinary users on purpose.
   */
  adminConfigured: boolean
}

/* ---------------- appearance ---------------- */

/**
 * A file the administrator installed for the signed-out screens. The bytes
 * live in the app's media folder; this record is the database row that points
 * at them.
 */
export interface LoginBackground {
  id: string
  mime: string
  originalName: string
  bytes: number
  createdAt: string
}

/** How the video is treated so text stays readable on top of it. */
export interface AppearanceTreatment {
  /** 0 = sharp, 40 = heavily blurred. */
  blur: number
  /** 0 = untouched, 92 = almost black. */
  dim: number
}

export interface LoginAppearance extends AppearanceTreatment {
  background: LoginBackground | null
}

/**
 * What a signed-out screen may know: whether there is a video, its type and
 * size, and the two treatment numbers — never a file name or a path. The bytes
 * arrive separately, over IPC, and are played from a Blob URL.
 */
export interface PublicAppearance extends AppearanceTreatment {
  /** Opaque id, used only to key the renderer's Blob cache. */
  assetId: string | null
  hasVideo: boolean
  mime: string | null
  bytes: number
}

/* ---------------- self-update ---------------- */

export type UpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'up-to-date'
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  /** Version currently running. */
  currentVersion: string
  /** Version the one-time installer put on disk — the fallback the bootstrap returns to. */
  installedVersion: string
  /** Version being downloaded or waiting to install. */
  version: string | null
  /** 0–100 while downloading. */
  percent: number
  bytesPerSecond: number
  /** Human-readable explanation for `error`, or a note otherwise. */
  message: string | null
  /** The technical reason behind `message`, shown small — never a substitute for it. */
  detail: string | null
  checkedAt: string | null
  canCheck: boolean
  canInstall: boolean
}

/**
 * The result of proving the update path works *now*, rather than only naming a
 * failure. Each step is a real request to GitHub, in the order a real check
 * makes them, so a green report means an update would download.
 */
export interface UpdateDiagnostics {
  checkedAt: string
  currentVersion: string
  latestVersion: string | null
  ok: boolean
  summary: string
  steps: Array<{ label: string; ok: boolean; detail: string }>
}

/* ---------------- backend connection ---------------- */

/**
 * Where the optional Supabase project lives, and what the last connection test
 * said. The key itself is never sent back to the renderer — only its last four
 * characters, so the panel can confirm something is stored.
 */
export interface BackendStatus {
  configured: boolean
  url: string | null
  keyHint: string | null
  /** True when the stored key is sealed with the OS keystore. */
  keySealed: boolean
  /** null until a test has run in this session. */
  reachable: boolean | null
  message: string | null
  checkedAt: string | null
}

export interface BackendConfigInput {
  url: string
  key: string
}

/* ---------------- cloud workspace ---------------- */

/**
 * What the panel shows about the connection to the shared workspace.
 *
 * `realtime` is how the mirror is being kept honest: `live` means a socket is
 * subscribed to the row, `polling` means the socket is unavailable and a short
 * interval is asking instead, `offline` means neither is working right now and
 * the machine is running on its local mirror.
 */
export type WorkspaceTransport = 'live' | 'polling' | 'offline'

export interface WorkspaceState {
  /** A workspace endpoint is configured (usually the one built into the app). */
  configured: boolean
  /** True when that endpoint is the one compiled into this build. */
  builtIn: boolean
  url: string | null
  signedIn: boolean
  email: string | null
  /** True when this account owns the workspace row and may change it. */
  owner: boolean
  /** The row still has no owner and can be claimed with the setup code. */
  claimable: boolean
  revision: number | null
  /** The revision whose settings this machine is currently running on. */
  appliedRevision: number | null
  lastSyncAt: string | null
  lastError: string | null
  transport: WorkspaceTransport
  /** A local change is waiting to be published. */
  pending: boolean
}

export interface WorkspaceCredentialsInput {
  email: string
  password: string
}

export interface WorkspaceClaimInput {
  code: string
}

/* ---------------- local activation keys ---------------- */

export type ActivationKeyStatus = 'unused' | 'used' | 'revoked' | 'expired'

export interface ActivationKeyRow {
  id: string
  label: string
  /** Masked for display; the full code is shown once, at creation. */
  maskedCode: string
  createdAt: string
  expiresAt: string | null
  usedAt: string | null
  usedByEmail: string | null
  revokedAt: string | null
  status: ActivationKeyStatus
}

/** Returned only from creation, when the plaintext code still exists. */
export interface CreatedActivationKey {
  id: string
  code: string
  label: string
  expiresAt: string | null
}

export interface CreateActivationKeyInput {
  count: number
  label?: string
  /** Null or 0 means the key never expires. */
  expiresInDays?: number | null
}

export interface AdminSystemInfo {
  appVersion: string
  electron: string
  chrome: string
  node: string
  platform: string
  databaseBytes: number
  schemaVersion: number
  startedAt: string
}

export interface AdminOverview {
  counts: {
    accounts: number
    projects: number
    memberships: number
    documents: number
    presentations: number
    slides: number
  }
  admin: AdminAccount
  /** The ordinary account currently signed in on this machine, if any. */
  sessionUserId: string | null
  accounts: AdminAccountRow[]
  projects: AdminProjectRow[]
  content: AdminContentRow[]
  activationKeys: ActivationKeyRow[]
  audit: AdminAuditEntry[]
  settings: AdminSettings
  appearance: LoginAppearance
  system: AdminSystemInfo
}

/* ---------------- project intelligence ---------------- */

export type GraphNodeKind = 'project' | 'owner' | 'member' | 'document' | 'presentation' | 'group'

export interface GraphNode {
  id: string
  kind: GraphNodeKind
  label: string
  detail?: string
  /** Free-form facts shown in the inspector. */
  meta?: Record<string, string>
  children?: GraphNode[]
}

export interface ProjectGraph {
  root: GraphNode
  counts: { members: number; documents: number; presentations: number }
}

/* ---------------- credits and AI ---------------- */

/*
 * The balance is the server's number, never the app's.
 *
 * Everything in this block is a *projection* of what Supabase said. The main
 * process keeps the last answer in SQLite so the Credits screen can draw
 * something honest while offline — it is labelled with when it was true, and
 * it is never used to decide whether a request may run. That decision happens
 * in the Edge Function, against the row, inside the transaction that charges.
 */
export interface CreditsState {
  /** False while this PC has no usable cloud identity yet. */
  connected: boolean
  plan: string
  planName: string
  daily: number
  purchased: number
  total: number
  dailyAllowance: number
  spentToday: number
  requestsToday: number
  resetAt: string | null
  planExpiresAt: string | null
  isAdmin: boolean
  /** When the server last confirmed these numbers. */
  syncedAt: string | null
  /** True when drawn from the local copy because the cloud could not be read. */
  cached: boolean
  /** Why the live read failed, in plain words, when it did. */
  message: string | null
}

/** One tier, as configured on the server. Price is in whole rupees. */
export interface CreditPlan {
  id: string
  name: string
  blurb: string
  dailyCredits: number
  priceInr: number
  sort: number
  current: boolean
  /** True when this is the tier the account's plan_expires_at refers to. */
  expiresAt: string | null
}

export type CreditEntryKind = 'usage' | 'purchase' | 'grant' | 'reset' | 'adjust'

export interface CreditLedgerEntry {
  id: string
  kind: CreditEntryKind
  /** Negative for usage, positive for everything that adds. */
  amount: number
  balanceAfter: number
  meta: Record<string, unknown>
  createdAt: string
}

export type PurchaseKind = 'plan' | 'credits'
export type PurchaseStatus = 'pending' | 'approved' | 'rejected'

export interface PurchaseRequest {
  id: string
  kind: PurchaseKind
  planId: string | null
  planName: string | null
  credits: number | null
  amountInr: number | null
  note: string
  status: PurchaseStatus
  createdAt: string
  decidedAt: string | null
}

export interface PurchaseRequestInput {
  kind: PurchaseKind
  /** Required for kind 'plan'. */
  planId?: string
  /** Required for kind 'credits'; priced by the server. */
  credits?: number
  note?: string
}

export type AiMode = 'chat' | 'research'
export type AiDepth = 'standard' | 'deep'

export interface AiCitation {
  title: string
  url: string
}

/** Tokens the provider actually reported, and what they cost. */
export interface AiUsage {
  prompt: number
  output: number
  total: number
  cost: number
}

export interface AiTraceStep {
  stage: string
  ms: number
  tokens: number
  credits: number
}

export interface AiAnswer {
  /** A local id, so a run can be referred to in the document and in history. */
  id: string
  mode: AiMode
  model: string
  answer: string
  /** The research questions the model chose, in the order it worked through them. */
  outline: string[]
  angle: string | null
  citations: AiCitation[]
  usage: AiUsage
  balance: CreditsState | null
  /** True when the run stopped because the balance ran out mid-way. */
  exhausted: boolean
  trace: AiTraceStep[]
  ms: number
}

export interface AiAskInput {
  projectId: string
  documentId: string
  prompt: string
  /** The passage the person selected, if any. */
  selection?: string
  depth?: AiDepth
  language?: string
  /** Earlier turns in this document's conversation, oldest first. */
  history?: { role: 'user' | 'model'; text: string }[]
}

/** One run this PC made, kept so the document can show what was written into it. */
export interface AiActivity {
  id: string
  documentId: string
  documentTitle: string
  mode: AiMode
  model: string
  prompt: string
  credits: number
  tokens: number
  citationCount: number
  createdAt: string
}

/* ---------------- credit administration ---------------- */

export interface AdminCreditAccount {
  id: string
  displayName: string
  username: string
  email: string | null
  plan: string
  planName: string
  daily: number
  purchased: number
  total: number
  requests: number
  planExpiresAt: string | null
  lastSignInAt: string | null
  suspended: boolean
}

export interface AdminCreditLedgerRow {
  id: string
  kind: CreditEntryKind
  amount: number
  balanceAfter: number
  meta: Record<string, unknown>
  createdAt: string
}

export interface AdminCreditSnapshot {
  /** Every pending request, oldest first — these are what someone has to act on. */
  pending: Array<PurchaseRequest & { accountId: string; accountName: string; accountEmail: string | null }>
  decided: Array<PurchaseRequest & { accountId: string; accountName: string; accountEmail: string | null }>
  plans: CreditPlan[]
  accounts: AdminCreditAccount[]
  /** The signed-in app account is an administrator in the cloud, not just here. */
  live: boolean
  message: string | null
}

export interface AdminPlanInput {
  id: string
  name?: string
  dailyCredits?: number
  priceInr?: number
  blurb?: string
}
