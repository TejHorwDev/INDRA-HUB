import { randomUUID } from 'node:crypto'
import { sessionForLocalUser } from '../lib/accountSession'
import { net } from 'electron'
import type {
  AdminTokenAccount,
  AiReadiness,
  AdminTokenAccountDetail,
  AdminTokenResetInfo,
  AdminTokenLedgerRow,
  AdminTokenSettingsInput,
  AdminTokenSnapshot,
  AdminPlanInput,
  AiActivity,
  AiAnswer,
  AiAskInput,
  AiCitation,
  AiMode,
  AdminSpendRow,
  AiTraceStep,
  AiUsage,
  TokenLedgerEntry,
  TokenPlan,
  TokenSettings,
  TokensState,
  PurchaseRequest,
  PurchaseRequestInput,
  SessionUser
} from '@shared/types'
import { normaliseUrl } from '@shared/workspace'
import { getDatabase } from '../db/database'
import { errors } from '../lib/errors'
import {
  adminCloudIdentity,
  adminCloudRole,
  adminCloudSession,
  assertCloudReachable,
  cloudEndpoint,
  cloudSession
} from './cloud'
import { getDocument } from './documents'

/*
 * Tokens and AI.
 *
 * The rule this file exists to protect: the balance lives on the server, and
 * the app only ever reports what the server said.
 *
 *   - Reading the balance is a call to indra_credit_state(). Nothing is copied
 *     anywhere: there is no local balance, so offline means no number at all
 *     rather than a stale one. The Edge Function asks the database before it
 *     spends anything.
 *   - Doing the work is a call to the indra-ai function. The provider key is in
 *     the cloud project's environment; it does not exist anywhere in this app,
 *     in a build, in a settings file, or in a log.
 *   - Charging happens there too, from the token counts the model reported. The
 *     app is not given a number it could round in its own favour.
 *
 * Everything that spends is refused while this PC has no route out, rather
 * than queued and quietly spent later.
 */

const FUNCTION_TIMEOUT_MS = 180_000
const PLAN_CACHE_KEY = 'ai_plans'

/* ---------------- the balance ---------------- */

interface WireState {
  plan?: string
  planName?: string
  daily?: number
  purchased?: number
  total?: number
  dailyAllowance?: number
  spentToday?: number
  requestsToday?: number
  resetAt?: string | null
  planExpiresAt?: string | null
  isAdmin?: boolean
  settings?: unknown
}

/**
 * The pricing rules, read defensively.
 *
 * These numbers decide what a person is quoted, so a missing field must never
 * become zero: every fallback is the same default the database ships with.
 */
export function asTokenSettings(value: unknown): TokenSettings | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const num = (key: string, fallback: number): number => {
    const parsed = Number(row[key])
    return Number.isFinite(parsed) ? parsed : fallback
  }
  const currency = typeof row.currency === 'string' && /^[A-Za-z]{3}$/.test(row.currency)
    ? row.currency.toUpperCase()
    : 'USD'
  return {
    currency,
    symbol: typeof row.symbol === 'string' && row.symbol ? row.symbol : '$',
    decimals: Math.min(Math.max(Math.round(num('decimals', 2)), 0), 3),
    topupTokens: Math.max(1, Math.round(num('topupTokens', 100_000))),
    topupPriceMinor: Math.max(0, Math.round(num('topupPriceMinor', 10_000))),
    minTopup: Math.max(1, Math.round(num('minTopup', 100_000))),
    maxTopup: Math.max(1, Math.round(num('maxTopup', 100_000_000))),
    lowBalance: Math.max(0, Math.round(num('lowBalance', 3_000))),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function disconnected(message: string): TokensState {
  return {
    connected: false,
    plan: 'free',
    planName: 'Free',
    daily: 0,
    purchased: 0,
    total: 0,
    dailyAllowance: 0,
    spentToday: 0,
    requestsToday: 0,
    resetAt: null,
    planExpiresAt: null,
    isAdmin: false,
    settings: null,
    syncedAt: null,
    cached: false,
    message
  }
}

function fromWire(state: WireState, syncedAt: string, cached: boolean): TokensState {
  const daily = Number(state.daily ?? 0)
  const purchased = Number(state.purchased ?? 0)
  return {
    connected: true,
    plan: typeof state.plan === 'string' ? state.plan : 'free',
    planName: typeof state.planName === 'string' ? state.planName : 'Free',
    daily,
    purchased,
    total: Number(state.total ?? daily + purchased),
    dailyAllowance: Number(state.dailyAllowance ?? 0),
    spentToday: Number(state.spentToday ?? 0),
    requestsToday: Number(state.requestsToday ?? 0),
    resetAt: state.resetAt ?? null,
    planExpiresAt: state.planExpiresAt ?? null,
    isAdmin: state.isAdmin === true,
    settings: asTokenSettings(state.settings),
    syncedAt,
    cached,
    message: null
  }
}

/**
 * The balance, from the server, every time.
 *
 * There used to be a local copy of this: a table in SQLite that let the screen
 * draw yesterday's number when the cloud was unreachable. It is gone. A balance
 * is the thing that decides whether a person may spend, so a copy of it kept on
 * the machine is a copy that can disagree with the server — and in the window
 * where it disagrees, the number on screen is simply wrong. Removing it also
 * removes a table that held, in plain JSON, how much every account on this PC
 * had left.
 *
 * Offline, the answer is that there is no answer. The screen says so, and the
 * AI panel refuses before it builds a request.
 */
export async function tokensState(viewer: SessionUser): Promise<TokensState> {
  if (viewer.mode === 'offline') {
    return disconnected('This PC is offline. A token balance lives on the server, so there is nothing to show until it answers.')
  }
  try {
    const session = await cloudSession(viewer)
    const state = await rpcCall<WireState>(session.token, 'indra_credit_state', {})
    return fromWire(state ?? {}, nowIso(), false)
  } catch (error) {
    return disconnected(messageFor(error))
  }
}

function messageFor(error: unknown): string {
  const text = error instanceof Error ? error.message : ''
  if (/offline|no cloud|route/i.test(text)) return 'This PC is offline. AI needs a connection.'
  if (/session|401|jwt/i.test(text)) return 'The cloud session expired. Sign in again to use AI.'
  return 'The cloud did not answer. The balance is unknown until it does.'
}

/* ---------------- transport to the function ---------------- */

interface FunctionError {
  error?: string
  message?: string
  balance?: WireState
}

/**
 * One call to the AI function, with the person's own token. The publishable key
 * rides along because the gateway wants it; it can do nothing on its own.
 */
async function callFunction<T>(token: string, body: Record<string, unknown>): Promise<T> {
  assertCloudReachable()
  const { url, key } = cloudEndpoint()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FUNCTION_TIMEOUT_MS)
  try {
    const response = await net.fetch(`${normaliseUrl(url)}/functions/v1/indra-ai`, {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    const raw = await response.text()
    let payload: unknown = null
    try {
      payload = raw ? JSON.parse(raw) : null
    } catch {
      payload = null
    }

    if (!response.ok) {
      const failure = (payload ?? {}) as FunctionError
      if (failure.error === 'insufficient_tokens' || failure.error === 'insufficient_credits') {
        throw errors.insufficientTokens(failure.message ?? 'You have no tokens left today.')
      }
      if (failure.error === 'unauthorized' || response.status === 401) {
        throw errors.authRequired()
      }
      throw errors.aiUnavailable(failure.message ?? 'AI could not run. Try again in a moment.')
    }
    if (!payload) throw errors.aiUnavailable('AI answered with something unreadable. Try again.')
    return payload as T
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw errors.aiUnavailable('The research run took longer than the app waits. Try a narrower question.')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

interface WireAnswer {
  answer?: string
  model?: string
  outline?: unknown
  angle?: unknown
  citations?: unknown
  usage?: unknown
  balance?: WireState
  exhausted?: boolean
  trace?: unknown
  ms?: number
}

function asCitations(value: unknown): AiCitation[] {
  if (!Array.isArray(value)) return []
  const out: AiCitation[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as { title?: unknown; url?: unknown }
    if (typeof row.url !== 'string' || !row.url) continue
    out.push({ title: typeof row.title === 'string' && row.title ? row.title : row.url, url: row.url })
  }
  return out
}

function asTrace(value: unknown): AiTraceStep[] {
  if (!Array.isArray(value)) return []
  const out: AiTraceStep[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as { stage?: unknown; ms?: unknown; tokens?: unknown; credits?: unknown }
    out.push({
      stage: typeof row.stage === 'string' ? row.stage : 'step',
      ms: Number(row.ms ?? 0),
      tokens: Number(row.tokens ?? row.credits ?? 0)
    })
  }
  return out
}

function asUsage(value: unknown): AiUsage {
  const row = (value ?? {}) as { prompt?: unknown; output?: unknown; total?: unknown; cost?: unknown }
  return {
    prompt: Number(row.prompt ?? 0),
    output: Number(row.output ?? 0),
    total: Number(row.total ?? 0),
    cost: Number(row.cost ?? 0)
  }
}

/* ---------------- the document, as the model sees it ---------------- */

const TAG = /<[^>]*>/g

function plainText(html: string | undefined): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(TAG, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function documentText(blocks: Array<{ type: string; html?: string; rows?: string[][]; alt?: string }>): string {
  const lines: string[] = []
  for (const block of blocks) {
    if (block.type === 'divider') continue
    if (block.type === 'image') {
      if (block.alt) lines.push(`[Image: ${block.alt}]`)
      continue
    }
    if (block.type === 'table' && Array.isArray(block.rows)) {
      const rows = block.rows.map((row) => row.map((cell) => plainText(cell)).join(' | '))
      if (rows.length) lines.push(rows.join('\n'))
      continue
    }
    const text = plainText(block.html)
    if (!text) continue
    const prefix = block.type === 'heading1' ? '# ' : block.type === 'heading2' ? '## ' : block.type === 'heading3' ? '### ' : block.type === 'bulleted' ? '- ' : block.type === 'quote' ? '> ' : ''
    lines.push(`${prefix}${text}`)
  }
  return lines.join('\n\n').slice(0, 60_000)
}

/* ---------------- ask, research, and the honest record of it ---------------- */

/**
 * Whether this workspace can actually run a model, asked of the function itself.
 *
 * The screens used to discover this by failing. A run would come back as a
 * generic "AI could not run", which reads like a bug in the app when it is a
 * missing key in the cloud project. The probe answers before anything is spent.
 */
export async function readiness(viewer: SessionUser): Promise<AiReadiness> {
  const session = await cloudSession(viewer)
  const payload = await callFunction<Partial<AiReadiness>>(session.token, { action: 'status' })
  const models =
    payload?.models && typeof payload.models === 'object'
      ? (payload.models as Record<string, string>)
      : {}
  return {
    configured: payload?.configured === true,
    keySource: typeof payload?.keySource === 'string' ? payload.keySource : null,
    models,
    research: payload?.research === true
  }
}

export async function ask(
  viewer: SessionUser,
  input: AiAskInput,
  mode: AiMode
): Promise<AiAnswer> {
  const prompt = (input.prompt ?? '').trim()
  if (!prompt) throw errors.validation('Ask something first.', 'prompt')
  if (prompt.length > 8000) throw errors.validation('That question is too long. Keep it under 8,000 characters.', 'prompt')

  const document = getDocument(viewer, input.projectId, input.documentId)
  const session = await cloudSession(viewer)

  const payload = await callFunction<WireAnswer>(session.token, {
    mode,
    prompt,
    document: documentText(document.blocks),
    documentTitle: document.title,
    selection: typeof input.selection === 'string' ? input.selection : '',
    depth: input.depth === 'deep' ? 'deep' : 'standard',
    language: typeof input.language === 'string' ? input.language.slice(0, 40) : '',
    history: Array.isArray(input.history)
      ? input.history.slice(-8).map((turn) => ({
          role: turn.role === 'model' ? 'model' : 'user',
          text: String(turn.text ?? '').slice(0, 4000)
        }))
      : []
  })

  const answer: AiAnswer = {
    id: randomUUID(),
    mode,
    model: typeof payload.model === 'string' ? payload.model : 'unknown',
    answer: typeof payload.answer === 'string' ? payload.answer : '',
    outline: Array.isArray(payload.outline)
      ? payload.outline.filter((q): q is string => typeof q === 'string').slice(0, 8)
      : [],
    angle: typeof payload.angle === 'string' && payload.angle ? payload.angle : null,
    citations: asCitations(payload.citations),
    usage: asUsage(payload.usage),
    balance: payload.balance ? fromWire(payload.balance, nowIso(), false) : null,
    exhausted: payload.exhausted === true,
    trace: asTrace(payload.trace),
    ms: Number(payload.ms ?? 0)
  }

  recordActivity(viewer.id, document.projectId, document.id, document.title, prompt, answer)
  return answer
}

function recordActivity(
  userId: string,
  projectId: string,
  documentId: string,
  documentTitle: string,
  prompt: string,
  answer: AiAnswer
): void {
  getDatabase()
    .prepare(
      `INSERT INTO ai_activity (id, user_id, project_id, document_id, document_title, mode, model, prompt, credits, tokens, citation_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      answer.id,
      userId,
      projectId,
      documentId,
      documentTitle,
      answer.mode,
      answer.model,
      prompt.slice(0, 500),
      answer.usage.cost,
      answer.usage.total,
      answer.citations.length,
      nowIso()
    )
}

export function activity(viewer: SessionUser, limit = 20): AiActivity[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, document_id, document_title, mode, model, prompt, credits, tokens, citation_count, created_at
         FROM ai_activity WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(viewer.id, Math.min(Math.max(limit, 1), 100)) as Array<{
    id: string
    document_id: string
    document_title: string
    mode: AiMode
    model: string
    prompt: string
    credits: number
    tokens: number
    citation_count: number
    created_at: string
  }>

  return rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    mode: row.mode,
    model: row.model,
    prompt: row.prompt,
    credits: row.credits,
    tokens: row.tokens,
    citationCount: row.citation_count,
    createdAt: row.created_at
  }))
}

/* ---------------- plans, ledger, purchases ---------------- */

interface WirePlan {
  id?: string
  name?: string
  blurb?: string
  daily_tokens?: number
  price_minor?: number
  sort?: number
  enabled?: boolean
}

async function fetchPlans(token: string, currentPlan: string): Promise<TokenPlan[]> {
  const rows = await restCall<WirePlan[]>(
    token,
    '/rest/v1/indra_plans?select=id,name,blurb,daily_tokens,price_minor,sort,enabled&order=sort.asc'
  )
  const plans = (rows ?? [])
    .filter((row) => typeof row.id === 'string')
    .map((row) => ({
      id: row.id as string,
      name: typeof row.name === 'string' ? row.name : (row.id as string),
      blurb: typeof row.blurb === 'string' ? row.blurb : '',
      dailyTokens: Number(row.daily_tokens ?? 0),
      priceMinor: Number(row.price_minor ?? 0),
      sort: Number(row.sort ?? 0),
      enabled: row.enabled !== false,
      current: row.id === currentPlan,
      expiresAt: null as string | null
    }))
  writePlansCache(plans)
  return plans
}

function writePlansCache(plans: TokenPlan[]): void {
  getDatabase()
    .prepare(
      `INSERT INTO app_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(PLAN_CACHE_KEY, JSON.stringify(plans))
}

function cachedPlans(): TokenPlan[] {
  const row = getDatabase().prepare('SELECT value FROM app_state WHERE key = ?').get(PLAN_CACHE_KEY) as
    | { value: string }
    | undefined
  if (!row) return []
  try {
    const parsed = JSON.parse(row.value) as TokenPlan[]
    return Array.isArray(parsed) ? parsed.map((plan) => ({ ...plan, current: false })) : []
  } catch {
    return []
  }
}

export async function tokenPlans(viewer: SessionUser): Promise<TokenPlan[]> {
  if (viewer.mode === 'offline') return cachedPlans()
  try {
    const session = await cloudSession(viewer)
    const state = await rpcCall<{ plan?: string; planExpiresAt?: string | null }>(
      session.token,
      'indra_credit_state',
      {}
    )
    const plans = await fetchPlans(session.token, typeof state?.plan === 'string' ? state.plan : 'free')
    return plans.map((plan) => ({
      ...plan,
      expiresAt: plan.current ? (state?.planExpiresAt ?? null) : null
    }))
  } catch {
    return cachedPlans()
  }
}

export async function tokenLedger(viewer: SessionUser, limit = 40): Promise<TokenLedgerEntry[]> {
  const session = await cloudSession(viewer)
  const rows = await rpcCall<Array<Record<string, unknown>>>(session.token, 'indra_my_ledger', {
    p_limit: Math.min(Math.max(limit, 1), 200)
  })
  return (rows ?? []).map((row) => ({
    id: String(row.id ?? randomUUID()),
    kind: (row.kind as TokenLedgerEntry['kind']) ?? 'adjust',
    amount: Number(row.amount ?? 0),
    balanceAfter: Number(row.balance_after ?? 0),
    meta: (row.meta as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at ?? nowIso())
  }))
}

interface WirePurchase {
  id?: string
  kind?: string
  plan_id?: string | null
  plan_name?: string | null
  /* The server column is still named `credits`; the app calls it tokens. */
  credits?: number | null
  tokens?: number | null
  amount_minor?: number | null
  currency?: string | null
  note?: string | null
  status?: string
  created_at?: string
  decided_at?: string | null
}

function mapPurchase(row: WirePurchase): PurchaseRequest {
  return {
    id: String(row.id ?? ''),
    kind: row.kind === 'credits' ? 'topup' : 'plan',
    planId: row.plan_id ?? null,
    planName: row.plan_name ?? null,
    tokens:
      row.tokens === null || row.tokens === undefined
        ? row.credits === null || row.credits === undefined
          ? null
          : Number(row.credits)
        : Number(row.tokens),
    amountMinor:
      row.amount_minor === null || row.amount_minor === undefined ? null : Number(row.amount_minor),
    currency: typeof row.currency === 'string' ? row.currency : null,
    note: typeof row.note === 'string' ? row.note : '',
    status: (row.status as PurchaseRequest['status']) ?? 'pending',
    createdAt: String(row.created_at ?? nowIso()),
    decidedAt: row.decided_at ?? null
  }
}

export async function purchaseRequests(viewer: SessionUser): Promise<PurchaseRequest[]> {
  const session = await cloudSession(viewer)
  const rows = await rpcCall<WirePurchase[]>(session.token, 'indra_my_purchases', {})
  // The server now joins the tier name in; the cache is only a fallback for an
  // older database that has not had the console migration yet.
  const names = new Map(cachedPlans().map((plan) => [plan.id, plan.name]))
  return (rows ?? []).map((row) => {
    const request = mapPurchase(row)
    return {
      ...request,
      planName: request.planName ?? (request.planId ? (names.get(request.planId) ?? null) : null)
    }
  })
}

export async function requestPurchase(
  viewer: SessionUser,
  input: PurchaseRequestInput
): Promise<PurchaseRequest[]> {
  const kind = input.kind === 'topup' ? 'credits' : 'plan'
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 400) : ''
  if (kind === 'plan' && !input.planId) {
    throw errors.validation('Choose the plan you want.', 'planId')
  }
  const tokens = kind === 'credits' ? Number(input.tokens ?? 0) : null
  if (kind === 'credits') {
    /*
     * Only the shape is checked here. What a top-up may be, and what it costs,
     * are settings the administrator owns: the server applies them, and its
     * refusal names the real limits, so this must not keep a stale copy of them.
     */
    if (!Number.isFinite(tokens) || tokens === null || !Number.isInteger(tokens) || tokens < 1) {
      throw errors.validation('Give a whole number of tokens.', 'tokens')
    }
    if (tokens > 100_000_000) {
      throw errors.validation('The largest single top-up is 100,000,000 tokens.', 'tokens')
    }
  }

  const session = await cloudSession(viewer)
  await rpcCall(session.token, 'indra_request_purchase', {
    p_kind: kind,
    p_plan: kind === 'plan' ? input.planId : null,
    p_tokens: tokens,
    p_note: note
  })
  return purchaseRequests(viewer)
}

export async function cancelPurchase(viewer: SessionUser, id: string): Promise<PurchaseRequest[]> {
  const session = await cloudSession(viewer)
  await rpcCall(session.token, 'indra_cancel_purchase', { p_id: id })
  return purchaseRequests(viewer)
}

/* ---------------- administration ---------------- */

interface WireAdminPurchase extends WirePurchase {
  user_id?: string
  user_name?: string | null
  user_email?: string | null
}

type AdminPurchase = PurchaseRequest & {
  accountId: string
  accountName: string
  accountEmail: string | null
}

/** One read of the request table, split into what needs answering and history. */
async function adminPurchases(token: string): Promise<AdminPurchase[]> {
  const rows = await rpcCall<WireAdminPurchase[]>(token, 'indra_admin_purchases', { p_status: null })
  return (rows ?? []).map((row) => ({
    ...mapPurchase(row),
    accountId: String(row.user_id ?? ''),
    accountName: (row.user_name ?? '').trim() || 'Member',
    accountEmail: row.user_email ?? null
  }))
}

/**
 * What the console shows an administrator.
 *
 * The identity is the installation's administrator (`admin:<id>`), not a
 * workspace account — see adminCloudSession(). That is what makes this console
 * work before anybody has signed in to the workspace at all, and keeps it
 * working when a member's session starts or ends.
 *
 * Two independent facts are reported, because they fail differently and the
 * panel must not confuse them: whether the server granted this administrator the
 * token role, and whether it answered at all.
 */
function accountSignedIn(adminId: string): boolean {
  try {
    return Boolean(sessionForLocalUser(adminId))
  } catch {
    return false
  }
}

export async function adminTokenSnapshot(adminId: string): Promise<AdminTokenSnapshot> {
  try {
    const session = await adminCloudSession(adminId)
    const state = await rpcCall<WireState>(session.token, 'indra_credit_state', {})
    /*
     * A failed identity lookup must not be able to mask the real answer below.
     * It is caught here and turned into `null`, and the panel then simply
     * omits the account line rather than reporting an error that did not happen.
     */
    const identity = await adminCloudIdentity(adminId).catch(() => null)
    if (state?.isAdmin !== true) {
      /*
       * Who administers is the first question an administrator actually has
       * here, and until now the panel answered it with the address of a machine.
       */
      const who = await rpcCall<{ email?: string } | null>(session.token, 'indra_admin_who', {}).catch(
        () => null
      )
      const adminEmail = typeof who?.email === 'string' ? who.email : null
      return {
        pending: [],
        decided: [],
        plans: cachedPlans(),
        accounts: [],
        settings: asTokenSettings(state?.settings),
        reset: null,
        identity,
        canClaim: accountSignedIn(adminId),
        live: false,
        claimed: false,
        reachable: true,
        /*
         * This message used to promise that the button below would work, which
         * it could not do on a reinstalled PC: the previous installation's
         * identity still held the role, and "only while nobody holds it" had
         * quietly become "never". It now states the two facts an administrator
         * needs — which account this PC is, and what the button will do — and
         * the server's own refusal replaces the guess below when it refuses.
         */
        message: adminEmail
          ? `This console is run by ${adminEmail}. Administration belongs to an account, not to an installation — sign in with that account and this screen opens with nothing to press.`
          : 'No account administers this installation yet. Sign in with your own account in Account & cloud; the server then records that account as the administrator, permanently and on every PC you sign in to.'
      }
    }

    const all = await adminPurchases(session.token)
    const pending = all.filter((request) => request.status === 'pending')
    const decided = all.filter((request) => request.status !== 'pending').slice(-40).reverse()
    const accountRows = await rpcCall<Array<Record<string, unknown>>>(session.token, 'indra_admin_accounts', {
      p_query: ''
    })
    const accounts: AdminTokenAccount[] = (accountRows ?? []).map((row) => ({
      id: String(row.id ?? ''),
      displayName: String(row.display_name ?? ''),
      username: String(row.username ?? ''),
      email: row.email === null || row.email === undefined ? null : String(row.email),
      plan: String(row.plan ?? 'free'),
      planName: String(row.plan_name ?? row.plan ?? 'Free'),
      daily: Number(row.daily ?? 0),
      purchased: Number(row.purchased ?? 0),
      total: Number(row.total ?? 0),
      requests: Number(row.requests ?? 0),
      planExpiresAt: (row.plan_expires_at as string | null) ?? null,
      lastSignInAt: (row.last_sign_in_at as string | null) ?? null,
      suspended: Boolean(row.suspended_at)
    }))
    const plans = await fetchPlans(session.token, typeof state.plan === 'string' ? state.plan : 'free')
    const reset = await rpcCall<Record<string, unknown>>(session.token, 'indra_credit_reset_info', {})
      .then((row): AdminTokenResetInfo | null =>
        row && typeof row.nextResetAt === 'string'
          ? {
              nextResetAt: row.nextResetAt,
              lastRefillAt: (row.lastRefillAt as string | null) ?? null,
              schedule: (row.schedule as string | null) ?? null,
              totalAccounts: Number(row.totalAccounts ?? accounts.length),
              suspendedAccounts: Number(row.suspendedAccounts ?? 0)
            }
          : null
      )
      // The refill clock is a nicety: the console must still open if this one
      // call fails, and it says it does not know rather than guessing.
      .catch(() => null)
    return {
      pending,
      decided,
      plans,
      accounts,
      settings: asTokenSettings(state.settings),
      reset,
      identity,
      canClaim: accountSignedIn(adminId),
      live: true,
      claimed: true,
      reachable: true,
      message: null
    }
  } catch (error) {
    return {
      pending: [],
      decided: [],
      plans: cachedPlans(),
      accounts: [],
      settings: null,
      reset: null,
      identity: null,
      canClaim: accountSignedIn(adminId),
      live: false,
      claimed: false,
      reachable: false,
      message: messageFor(error)
    }
  }
}

export async function adminDecidePurchase(
  adminId: string,
  id: string,
  approve: boolean,
  note: string
): Promise<AdminTokenSnapshot> {
  const session = await adminCloudSession(adminId)
  await rpcCall(session.token, 'indra_admin_decide_purchase', {
    p_id: id,
    p_approve: approve,
    p_note: note.slice(0, 400)
  })
  return adminTokenSnapshot(adminId)
}

export async function adminSetPlan(
  adminId: string,
  userId: string,
  planId: string,
  days = 30
): Promise<AdminTokenSnapshot> {
  const session = await adminCloudSession(adminId)
  await rpcCall(session.token, 'indra_admin_set_plan', {
    p_user: userId,
    p_plan: planId,
    p_days: Math.min(Math.max(Math.round(days) || 30, 1), 3650)
  })
  return adminTokenSnapshot(adminId)
}

export async function adminGrant(
  adminId: string,
  userId: string,
  amount: number,
  reason: string
): Promise<AdminTokenSnapshot> {
  const tokens = Math.round(Number(amount))
  if (!Number.isFinite(tokens) || tokens === 0) {
    throw errors.validation('Give an amount of tokens, positive or negative.', 'amount')
  }
  if (Math.abs(tokens) > 50_000_000) {
    throw errors.validation('The largest single adjustment is 50,000,000 tokens.', 'amount')
  }
  const session = await adminCloudSession(adminId)
  await rpcCall(session.token, 'indra_admin_grant_credits', {
    p_user: userId,
    p_amount: tokens,
    p_reason: reason.slice(0, 200)
  })
  return adminTokenSnapshot(adminId)
}

export async function adminUpdatePlan(
  adminId: string,
  input: AdminPlanInput
): Promise<TokenPlan[]> {
  if (!input.id) throw errors.validation('Choose a plan.', 'id')
  const session = await adminCloudSession(adminId)
  await rpcCall(session.token, 'indra_admin_save_plan', {
    p_id: input.id,
    p_name: input.name ?? null,
    p_blurb: input.blurb ?? null,
    p_daily: input.dailyTokens === undefined ? null : Math.round(input.dailyTokens),
    p_price_minor: input.priceMinor === undefined ? null : Math.round(input.priceMinor),
    p_sort: input.sort === undefined ? null : Math.round(input.sort),
    p_enabled: input.enabled === undefined ? null : input.enabled,
    p_create: input.create === true
  })
  return fetchPlans(session.token, input.id)
}

/**
 * The pricing rules: currency, the top-up pack and what it costs, the limits.
 *
 * Written whole so two fields can never disagree, and read back from the
 * server's own row — the console shows what was saved, not what was typed.
 */
export async function adminUpdateTokenSettings(
  adminId: string,
  input: AdminTokenSettingsInput
): Promise<TokenSettings> {
  const session = await adminCloudSession(adminId)
  const row = await rpcCall<unknown>(session.token, 'indra_admin_update_credit_settings', {
    p_currency: input.currency ?? null,
    p_symbol: input.symbol ?? null,
    p_decimals: input.decimals === undefined ? null : Math.round(input.decimals),
    p_topup_tokens: input.topupTokens === undefined ? null : Math.round(input.topupTokens),
    p_topup_price_minor:
      input.topupPriceMinor === undefined ? null : Math.round(input.topupPriceMinor),
    p_min_topup: input.minTopup === undefined ? null : Math.round(input.minTopup),
    p_max_topup: input.maxTopup === undefined ? null : Math.round(input.maxTopup),
    p_low_balance: input.lowBalance === undefined ? null : Math.round(input.lowBalance)
  })
  const settings = asTokenSettings(row)
  if (!settings) throw errors.validation('The server did not return the new settings.')
  return settings
}

export async function adminLedger(
  adminId: string,
  userId: string,
  limit = 40
): Promise<AdminTokenLedgerRow[]> {
  const session = await adminCloudSession(adminId)
  const rows = await rpcCall<Array<Record<string, unknown>>>(session.token, 'indra_admin_ledger', {
    p_user: userId,
    p_limit: Math.min(Math.max(limit, 1), 200)
  })
  return (rows ?? []).map((row) => ({
    id: String(row.id ?? randomUUID()),
    kind: (row.kind as AdminTokenLedgerRow['kind']) ?? 'adjust',
    amount: Number(row.amount ?? 0),
    balanceAfter: Number(row.balance_after ?? 0),
    meta: (row.meta as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at ?? nowIso())
  }))
}

export async function adminSetSuspended(
  adminId: string,
  userId: string,
  suspended: boolean
): Promise<AdminTokenSnapshot> {
  const session = await adminCloudSession(adminId)
  await rpcCall(session.token, 'indra_admin_set_suspended', {
    p_user: userId,
    p_suspended: suspended
  })
  return adminTokenSnapshot(adminId)
}

/**
 * Refills every account's daily allowance now, on the server's clock.
 *
 * The schedule does this at 00:05 UTC on its own; this is for the administrator
 * who has just changed what a tier is worth and does not want to wait a day, or
 * who is fixing a plan after the fact. It is idempotent — an account already
 * refilled today is left alone.
 */
export async function adminResetDaily(adminId: string): Promise<{ refilled: number; snapshot: AdminTokenSnapshot }> {
  const session = await adminCloudSession(adminId)
  const refilled = await rpcCall<number>(session.token, 'indra_admin_reset_daily', {})
  return { refilled: Number(refilled ?? 0), snapshot: await adminTokenSnapshot(adminId) }
}

/** Every account's movement, newest first — the console's log of the whole fleet. */
export async function adminSpendLog(adminId: string, limit = 60): Promise<AdminSpendRow[]> {
  const session = await adminCloudSession(adminId)
  const rows = await rpcCall<Array<Record<string, unknown>>>(session.token, 'indra_admin_spend_log', {
    p_limit: Math.min(Math.max(limit, 1), 200)
  })
  return (rows ?? []).map((row) => ({
    id: String(row.id ?? randomUUID()),
    userId: String(row.user_id ?? ''),
    accountName: String(row.display_name ?? 'Member'),
    kind: (row.kind as AdminSpendRow['kind']) ?? 'adjust',
    amount: Number(row.amount ?? 0),
    balanceAfter: Number(row.balance_after ?? 0),
    meta: (row.meta as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at ?? nowIso())
  }))
}

/** One account with everything the panel needs to answer a support question. */
export async function adminAccountDetail(
  adminId: string,
  userId: string
): Promise<AdminTokenAccountDetail> {
  const session = await adminCloudSession(adminId)
  const payload = await rpcCall<{
    account?: Record<string, unknown>
    ledger?: Array<Record<string, unknown>>
  }>(session.token, 'indra_admin_account', { p_user: userId })
  const row = payload?.account ?? {}
  return {
    account: {
      id: String(row.id ?? userId),
      displayName: String(row.display_name ?? ''),
      username: String(row.username ?? ''),
      email: row.email === null || row.email === undefined ? null : String(row.email),
      plan: String(row.plan ?? 'free'),
      planName: String(row.plan_name ?? row.plan ?? 'Free'),
      daily: Number(row.daily ?? 0),
      purchased: Number(row.purchased ?? 0),
      total: Number(row.total ?? 0),
      requests: Number(row.requests ?? 0),
      planExpiresAt: (row.plan_expires_at as string | null) ?? null,
      lastSignInAt: (row.last_sign_in_at as string | null) ?? null,
      suspended: Boolean(row.suspended_at),
      createdAt: String(row.created_at ?? ''),
      memberNo: (row.member_no as string | null) ?? null,
      tokensResetAt: ((row.tokens_reset_at ?? row.credits_reset_at) as string | null) ?? null
    },
    ledger: (payload?.ledger ?? []).map((entry) => ({
      id: String(entry.id ?? randomUUID()),
      kind: (entry.kind as AdminTokenLedgerRow['kind']) ?? 'adjust',
      amount: Number(entry.amount ?? 0),
      balanceAfter: Number(entry.balance_after ?? 0),
      meta: (entry.meta as Record<string, unknown>) ?? {},
      createdAt: String(entry.created_at ?? nowIso())
    }))
  }
}

/**
 * Takes the credit-administrator role for this installation, once.
 *
 * The server allows it only while no credit administrator exists, so on a fresh
 * project the first panel that asks becomes the one that owns it — and no
 * client, this one included, can hand itself the role afterwards. Returns the
 * snapshot so the panel shows the result rather than claiming success.
 */
export async function adminClaimTokenRole(adminId: string): Promise<AdminTokenSnapshot> {
  try {
    const role = await adminCloudRole(adminId, true)
    if (!role.isAdmin && role.refused) {
      return {
        pending: [],
        decided: [],
        plans: cachedPlans(),
        accounts: [],
        settings: null,
        reset: null,
        identity: null,
        canClaim: accountSignedIn(adminId),
        live: false,
        claimed: false,
        reachable: true,
        message: role.refused
      }
    }
  } catch (error) {
    return {
      pending: [],
      decided: [],
      plans: cachedPlans(),
      accounts: [],
      settings: null,
      reset: null,
      identity: null,
      canClaim: accountSignedIn(adminId),
      live: false,
      claimed: false,
      reachable: false,
      message: messageFor(error)
    }
  }
  return adminTokenSnapshot(adminId)
}

/* ---------------- REST, with the person's own token ---------------- */

async function call(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<unknown> {
  assertCloudReachable()
  const { url, key } = cloudEndpoint()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await net.fetch(`${normaliseUrl(url)}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        apikey: key,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        prefer: 'return=representation'
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`cloud ${response.status}: ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : null
  } finally {
    clearTimeout(timer)
  }
}

async function rpcCall<T = unknown>(token: string, fn: string, args: Record<string, unknown>): Promise<T> {
  return (await call(token, `/rest/v1/rpc/${fn}`, { method: 'POST', body: args })) as T
}

async function restCall<T = unknown>(token: string, path: string): Promise<T> {
  return (await call(token, path)) as T
}
