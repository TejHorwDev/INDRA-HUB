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
}

/** Public projection used by member lists and search. */
export interface UserSummary {
  id: string
  username: string
  displayName: string
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
  joinedAt: string
}

export interface ProjectSummary {
  id: string
  name: string
  description: string
  ownerId: string
  ownerName: string
  createdAt: string
  updatedAt: string
  memberCount: number
  /** The signed-in user's relationship to this project. */
  role: ProjectRole
}

export interface ProjectDetail extends ProjectSummary {
  owner: UserSummary
  members: ProjectMember[]
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
  /** Version being downloaded or waiting to install. */
  version: string | null
  /** 0–100 while downloading. */
  percent: number
  bytesPerSecond: number
  /** Human-readable explanation for `error`, or a note otherwise. */
  message: string | null
  checkedAt: string | null
  canCheck: boolean
  canInstall: boolean
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
