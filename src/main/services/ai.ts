import { randomUUID } from 'node:crypto'
import { net } from 'electron'
import type {
  AdminCreditAccount,
  AdminCreditLedgerRow,
  AdminCreditSnapshot,
  AdminPlanInput,
  AiActivity,
  AiAnswer,
  AiAskInput,
  AiCitation,
  AiMode,
  AiTraceStep,
  AiUsage,
  CreditLedgerEntry,
  CreditPlan,
  CreditsState,
  PurchaseRequest,
  PurchaseRequestInput,
  SessionUser
} from '@shared/types'
import { normaliseUrl } from '@shared/workspace'
import { getDatabase } from '../db/database'
import { errors } from '../lib/errors'
import { assertCloudReachable, cloudEndpoint, cloudSession } from './cloud'
import { getDocument } from './documents'

/*
 * Credits and AI.
 *
 * The rule this file exists to protect: the balance lives on the server, and
 * the app only ever reports what the server said.
 *
 *   - Reading the balance is a call to indra_credit_state(). The answer is
 *     copied into SQLite so the Credits screen is not blank when the machine is
 *     offline, and that copy carries the time it was taken. It is never used to
 *     decide whether a request may run — the Edge Function asks the database.
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
}

function nowIso(): string {
  return new Date().toISOString()
}

function disconnected(message: string): CreditsState {
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
    syncedAt: null,
    cached: false,
    message
  }
}

function fromWire(state: WireState, syncedAt: string, cached: boolean): CreditsState {
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
    syncedAt,
    cached,
    message: null
  }
}

function readCache(userId: string): { state: CreditsState; syncedAt: string } | null {
  const row = getDatabase()
    .prepare('SELECT state, synced_at FROM ai_credit_cache WHERE user_id = ?')
    .get(userId) as { state: string; synced_at: string } | undefined
  if (!row) return null
  try {
    const parsed = JSON.parse(row.state) as WireState
    return { state: fromWire(parsed, row.synced_at, true), syncedAt: row.synced_at }
  } catch {
    return null
  }
}

function writeCache(userId: string, state: CreditsState): void {
  if (!state.connected) return
  getDatabase()
    .prepare(
      `INSERT INTO ai_credit_cache (user_id, state, synced_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, synced_at = excluded.synced_at`
    )
    .run(userId, JSON.stringify(state), state.syncedAt ?? nowIso())
}

/**
 * The balance the server currently holds.
 *
 * `allowCache` is for screens that must draw something: the Credits page opens
 * with the last known numbers, marked with when they were true, and refreshes
 * them a moment later. Sign-in paths and the admin console pass false, because
 * a stale number there would be a lie with consequences.
 */
export async function creditsState(viewer: SessionUser, allowCache = false): Promise<CreditsState> {
  if (viewer.mode === 'offline') {
    return disconnected('The offline workspace has no cloud account, so it has no credits. Sign in to use AI.')
  }
  try {
    const session = await cloudSession(viewer)
    const state = await rpcCall<WireState>(session.token, 'indra_credit_state', {})
    const mapped = fromWire(state ?? {}, nowIso(), false)
    writeCache(viewer.id, mapped)
    return mapped
  } catch (error) {
    const cached = allowCache ? readCache(viewer.id) : null
    if (cached) {
      return {
        ...cached.state,
        cached: true,
        message: 'Showing the last balance this PC saw. It will refresh when the cloud is reachable.'
      }
    }
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
      if (failure.error === 'insufficient_credits') {
        throw errors.insufficientCredits(failure.message ?? 'You have no credits left today.')
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
      tokens: Number(row.tokens ?? 0),
      credits: Number(row.credits ?? 0)
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

  if (answer.balance) writeCache(viewer.id, answer.balance)

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
  daily_credits?: number
  price_inr?: number
  sort?: number
}

async function fetchPlans(token: string, currentPlan: string): Promise<CreditPlan[]> {
  const rows = await restCall<WirePlan[]>(
    token,
    '/rest/v1/indra_plans?select=id,name,blurb,daily_credits,price_inr,sort&order=sort.asc'
  )
  const plans = (rows ?? [])
    .filter((row) => typeof row.id === 'string')
    .map((row) => ({
      id: row.id as string,
      name: typeof row.name === 'string' ? row.name : (row.id as string),
      blurb: typeof row.blurb === 'string' ? row.blurb : '',
      dailyCredits: Number(row.daily_credits ?? 0),
      priceInr: Number(row.price_inr ?? 0),
      sort: Number(row.sort ?? 0),
      current: row.id === currentPlan,
      expiresAt: null as string | null
    }))
  writePlansCache(plans)
  return plans
}

function writePlansCache(plans: CreditPlan[]): void {
  getDatabase()
    .prepare(
      `INSERT INTO app_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(PLAN_CACHE_KEY, JSON.stringify(plans))
}

function cachedPlans(): CreditPlan[] {
  const row = getDatabase().prepare('SELECT value FROM app_state WHERE key = ?').get(PLAN_CACHE_KEY) as
    | { value: string }
    | undefined
  if (!row) return []
  try {
    const parsed = JSON.parse(row.value) as CreditPlan[]
    return Array.isArray(parsed) ? parsed.map((plan) => ({ ...plan, current: false })) : []
  } catch {
    return []
  }
}

export async function creditPlans(viewer: SessionUser): Promise<CreditPlan[]> {
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

export async function creditLedger(viewer: SessionUser, limit = 40): Promise<CreditLedgerEntry[]> {
  const session = await cloudSession(viewer)
  const rows = await rpcCall<Array<Record<string, unknown>>>(session.token, 'indra_my_ledger', {
    p_limit: Math.min(Math.max(limit, 1), 200)
  })
  return (rows ?? []).map((row) => ({
    id: String(row.id ?? randomUUID()),
    kind: (row.kind as CreditLedgerEntry['kind']) ?? 'adjust',
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
  credits?: number | null
  amount_inr?: number | null
  note?: string | null
  status?: string
  created_at?: string
  decided_at?: string | null
}

function mapPurchase(row: WirePurchase): PurchaseRequest {
  return {
    id: String(row.id ?? ''),
    kind: row.kind === 'credits' ? 'credits' : 'plan',
    planId: row.plan_id ?? null,
    planName: row.plan_name ?? null,
    credits: row.credits === null || row.credits === undefined ? null : Number(row.credits),
    amountInr: row.amount_inr === null || row.amount_inr === undefined ? null : Number(row.amount_inr),
    note: typeof row.note === 'string' ? row.note : '',
    status: (row.status as PurchaseRequest['status']) ?? 'pending',
    createdAt: String(row.created_at ?? nowIso()),
    decidedAt: row.decided_at ?? null
  }
}

export async function purchaseRequests(viewer: SessionUser): Promise<PurchaseRequest[]> {
  const session = await cloudSession(viewer)
  const rows = await rpcCall<WirePurchase[]>(session.token, 'indra_my_purchases', {})
  const names = new Map(cachedPlans().map((plan) => [plan.id, plan.name]))
  return (rows ?? []).map((row) => {
    const request = mapPurchase(row)
    return { ...request, planName: request.planId ? (names.get(request.planId) ?? null) : null }
  })
}

export async function requestPurchase(
  viewer: SessionUser,
  input: PurchaseRequestInput
): Promise<PurchaseRequest[]> {
  const kind = input.kind === 'credits' ? 'credits' : 'plan'
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 400) : ''
  if (kind === 'plan' && !input.planId) {
    throw errors.validation('Choose the plan you want.', 'planId')
  }
  const credits = kind === 'credits' ? Number(input.credits ?? 0) : null
  if (kind === 'credits') {
    if (!Number.isFinite(credits) || credits === null || credits < 100 || credits > 100_000) {
      throw errors.validation('Top-ups start at 100 credits.', 'credits')
    }
  }

  const session = await cloudSession(viewer)
  await rpcCall(session.token, 'indra_request_purchase', {
    p_kind: kind,
    p_plan: kind === 'plan' ? input.planId : null,
    p_credits: credits,
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

export async function adminCreditSnapshot(viewer: SessionUser): Promise<AdminCreditSnapshot> {
  if (viewer.mode === 'offline') {
    return { pending: [], decided: [], plans: cachedPlans(), accounts: [], live: false, message: 'The offline workspace is not an administrator in the cloud.' }
  }
  try {
    const session = await cloudSession(viewer)
    const state = await rpcCall<WireState>(session.token, 'indra_credit_state', {})
    if (state?.isAdmin !== true) {
      return {
        pending: [],
        decided: [],
        plans: await creditPlans(viewer),
        accounts: [],
        live: false,
        message: 'This cloud account is not an administrator. Credits can only be managed by an account with that role on the server.'
      }
    }

    const all = await adminPurchases(session.token)
    const pending = all.filter((request) => request.status === 'pending')
    const decided = all.filter((request) => request.status !== 'pending').slice(-40).reverse()
    const accountRows = await rpcCall<Array<Record<string, unknown>>>(session.token, 'indra_admin_accounts', {
      p_query: ''
    })
    const accounts: AdminCreditAccount[] = (accountRows ?? []).map((row) => ({
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
    return { pending, decided, plans, accounts, live: true, message: null }
  } catch (error) {
    return {
      pending: [],
      decided: [],
      plans: cachedPlans(),
      accounts: [],
      live: false,
      message: messageFor(error)
    }
  }
}

export async function adminDecidePurchase(
  viewer: SessionUser,
  id: string,
  approve: boolean,
  note: string
): Promise<AdminCreditSnapshot> {
  const session = await cloudSession(viewer)
  await rpcCall(session.token, 'indra_admin_decide_purchase', {
    p_id: id,
    p_approve: approve,
    p_note: note.slice(0, 400)
  })
  return adminCreditSnapshot(viewer)
}

export async function adminSetPlan(
  viewer: SessionUser,
  userId: string,
  planId: string,
  days = 30
): Promise<AdminCreditSnapshot> {
  const session = await cloudSession(viewer)
  await rpcCall(session.token, 'indra_admin_set_plan', {
    p_user: userId,
    p_plan: planId,
    p_days: Math.min(Math.max(Math.round(days) || 30, 1), 3650)
  })
  return adminCreditSnapshot(viewer)
}

export async function adminGrant(
  viewer: SessionUser,
  userId: string,
  amount: number,
  reason: string
): Promise<AdminCreditSnapshot> {
  const credits = Math.round(Number(amount))
  if (!Number.isFinite(credits) || credits === 0) {
    throw errors.validation('Give an amount of credits, positive or negative.', 'amount')
  }
  if (Math.abs(credits) > 1_000_000) {
    throw errors.validation('The largest single adjustment is 1,000,000 credits.', 'amount')
  }
  const session = await cloudSession(viewer)
  await rpcCall(session.token, 'indra_admin_grant_credits', {
    p_user: userId,
    p_amount: credits,
    p_reason: reason.slice(0, 200)
  })
  return adminCreditSnapshot(viewer)
}

export async function adminUpdatePlan(
  viewer: SessionUser,
  input: AdminPlanInput
): Promise<CreditPlan[]> {
  if (!input.id) throw errors.validation('Choose a plan.', 'id')
  const session = await cloudSession(viewer)
  await rpcCall(session.token, 'indra_admin_update_plan', {
    p_id: input.id,
    p_name: input.name ?? null,
    p_daily: input.dailyCredits === undefined ? null : Math.round(input.dailyCredits),
    p_price: input.priceInr === undefined ? null : Math.round(input.priceInr),
    p_blurb: input.blurb ?? null
  })
  return fetchPlans(session.token, input.id)
}

export async function adminLedger(
  viewer: SessionUser,
  userId: string,
  limit = 40
): Promise<AdminCreditLedgerRow[]> {
  const session = await cloudSession(viewer)
  const rows = await rpcCall<Array<Record<string, unknown>>>(session.token, 'indra_admin_ledger', {
    p_user: userId,
    p_limit: Math.min(Math.max(limit, 1), 200)
  })
  return (rows ?? []).map((row) => ({
    id: String(row.id ?? randomUUID()),
    kind: (row.kind as AdminCreditLedgerRow['kind']) ?? 'adjust',
    amount: Number(row.amount ?? 0),
    balanceAfter: Number(row.balance_after ?? 0),
    meta: (row.meta as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at ?? nowIso())
  }))
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
