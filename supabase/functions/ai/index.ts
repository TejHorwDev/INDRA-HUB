/*
 * indra-ai — the only place a model is called with the workspace's key.
 *
 * The desktop app never holds a provider key and never talks to a model
 * directly. It sends the person's cloud token, the document it is working in,
 * and a question. This function verifies that token, reads the balance that
 * belongs to it, does the work, measures the tokens the provider actually
 * reported, and charges those tokens. The charge runs as service_role through
 * indra_spend_ai(), which is the one function in the schema that can move a
 * balance — and which no client can execute.
 *
 * Two modes:
 *   chat      one grounded turn, for "write this better" inside a document.
 *   research  plan -> several independent searches -> synthesis with sources.
 *             This is the part that makes the feature worth paying for: the
 *             answer is built from pages that were actually read, and every
 *             claim carries the page it came from.
 *
 * Nothing is estimated. If the provider does not report usage, the request
 * fails rather than guessing a price.
 */

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store'
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS'
}

const MODELS = {
  chat: Deno.env.get('AI_CHAT_MODEL') ?? 'gemini-2.5-flash',
  plan: Deno.env.get('AI_PLAN_MODEL') ?? 'gemini-2.5-flash',
  search: Deno.env.get('AI_SEARCH_MODEL') ?? 'gemini-2.5-flash',
  research: Deno.env.get('AI_RESEARCH_MODEL') ?? 'gemini-2.5-pro'
}

const MAX_INPUT_CHARS = 60_000
const SEARCH_TIMEOUT_MS = 55_000
const TOTAL_BUDGET_MS = 135_000

interface Citation {
  title: string
  url: string
}

interface Usage {
  prompt: number
  output: number
  total: number
  cost: number
}

interface TraceEntry {
  stage: string
  ms: number
  tokens: number
  credits: number
}

interface Supa {
  url: string
  anon: string
  service: string
}

function env(): Supa {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return { url, anon, service }
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...CORS } })
}

function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return reply({ error: code, message, ...extra }, status)
}

/**
 * What a run costs, in tokens.
 *
 * It costs the tokens it used. There is no exchange rate and no rounding step:
 * the provider reports a token count, and that count is the charge. One token
 * is one token, which is the only definition that cannot drift between what a
 * screen says and what a run spends.
 */
/*
 * The charge is the token count. There is no rate to apply: a "credit" no
 * longer exists as a separate unit, so `costOf` is only here to refuse a
 * nonsense number from a provider (negative, NaN, or a fraction).
 */
function costOf(tokens: number): number {
  return Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : 0
}

/** A short, honest ceiling on how much of the document is worth sending. */
function clamp(text: string, limit = MAX_INPUT_CHARS): string {
  const clean = (text ?? '').replace(/\u0000/g, '').trim()
  return clean.length > limit ? `${clean.slice(0, limit)}\n\n[The rest of the document was trimmed for length.]` : clean
}

/* ---------------- REST plumbing (no SDK, one dependency less) ---------------- */

async function rest<T>(supa: Supa, path: string, init: {
  token: string
  method?: string
  body?: unknown
}): Promise<T> {
  const response = await fetch(`${supa.url}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: supa.anon,
      authorization: `Bearer ${init.token}`,
      'content-type': 'application/json'
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`supa ${response.status}: ${text.slice(0, 300)}`)
  }
  return (text ? JSON.parse(text) : undefined) as T
}

async function rpc<T>(supa: Supa, fn: string, args: Record<string, unknown>, token: string): Promise<T> {
  return rest<T>(supa, `/rest/v1/rpc/${fn}`, { method: 'POST', body: args, token })
}

/** The token has to be a real Supabase session, not a hand-written claim. */
async function caller(supa: Supa, token: string): Promise<{ id: string; email?: string }> {
  const response = await fetch(`${supa.url}/auth/v1/user`, {
    headers: { apikey: supa.anon, authorization: `Bearer ${token}` }
  })
  if (!response.ok) throw new Error('invalid_token')
  const user = (await response.json()) as { id?: string; email?: string }
  if (!user?.id) throw new Error('invalid_token')
  return { id: user.id, email: user.email }
}

/** The profile row the token functions key on. Service role: the caller cannot see other rows anyway. */
async function profileOf(supa: Supa, uid: string): Promise<string> {
  const rows = await rest<{ id: string }[]>(
    supa,
    `/rest/v1/indra_users?select=id&auth_user_id=eq.${encodeURIComponent(uid)}&limit=1`,
    { token: supa.service }
  )
  const id = rows?.[0]?.id
  if (!id) throw new Error('no_profile')
  return id
}

/* ---------------- Gemini ---------------- */

interface GeminiPart {
  text?: string
  thought?: boolean
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: GeminiPart[] }
    finishReason?: string
    groundingMetadata?: {
      groundingChunks?: { web?: { uri?: string; title?: string } }[]
      webSearchQueries?: string[]
    }
  }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    thoughtsTokenCount?: number
    totalTokenCount?: number
  }
  error?: { message?: string; status?: string }
}

interface TurnResult {
  text: string
  citations: Citation[]
  queries: string[]
  usage: Usage
}

interface TurnInput {
  key: string
  model: string
  system: string
  prompt: string
  grounded: boolean
  temperature: number
  maxOutputTokens: number
  json: boolean
  timeoutMs: number
}

async function turn(input: TurnInput): Promise<TurnResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs)
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': input.key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
          ...(input.grounded ? { tools: [{ google_search: {} }] } : {}),
          generationConfig: {
            temperature: input.temperature,
            maxOutputTokens: input.maxOutputTokens,
            ...(input.json ? { responseMimeType: 'application/json' } : {})
          }
        })
      }
    )

    const payload = (await response.json().catch(() => ({}))) as GeminiResponse
    if (!response.ok) {
      const detail = payload?.error?.message ?? `status ${response.status}`
      throw new Error(`provider: ${detail}`)
    }

    const usage = payload.usageMetadata
    const promptTokens = usage?.promptTokenCount ?? 0
    const outputTokens = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0)
    const total = usage?.totalTokenCount ?? promptTokens + outputTokens
    if (!total) throw new Error('provider: no token accounting returned')

    const candidate = payload.candidates?.[0]
    const parts = candidate?.content?.parts ?? []
    const text = parts
      .filter((part) => part.text && part.thought !== true)
      .map((part) => part.text)
      .join('')
      .trim()

    const citations: Citation[] = []
    for (const chunk of candidate?.groundingMetadata?.groundingChunks ?? []) {
      const url = chunk?.web?.uri
      if (!url) continue
      if (citations.some((known) => known.url === url)) continue
      citations.push({ title: (chunk.web?.title ?? url).trim(), url })
    }

    return {
      text,
      citations,
      queries: candidate?.groundingMetadata?.webSearchQueries ?? [],
      usage: { prompt: promptTokens, output: outputTokens, total, cost: costOf(total) }
    }
  } finally {
    clearTimeout(timer)
  }
}

/* ---------------- prompts ---------------- */

const CHAT_SYSTEM = `You are the research and writing partner inside INDRA HUB, a desktop workspace for documents.
You are embedded in one document. Your job is to move the writing forward, not to talk about it.
Rules:
- Write in the document's own voice and tense; match the person's register.
- Prefer concrete, checkable statements. If you are not certain of a fact, say what is uncertain in one plain clause instead of inventing detail.
- Return prose that can be pasted in directly. Markdown headings and lists are fine when the surrounding document uses them.
- No preamble, no "certainly", no summary of what you are about to do.
- Never claim to have browsed unless the material you were given contains sources.`

const PLAN_SYSTEM = `You plan deep research. Given a topic and the document it belongs to, produce the questions that would have to be answered for a genuinely useful, non-generic treatment.
Rules:
- 3 to 6 questions, each narrow enough that a single search answers it.
- Cover the mechanism, the evidence, the strongest counter-argument, and the current state.
- No question that is just the topic restated.
Return JSON only: {"questions": ["...", "..."], "angle": "one sentence on the through-line"}.`

const SEARCH_SYSTEM = `You are a research assistant. Answer the question using web search. Be precise and sparing: 120 words at most, no preamble, only what the sources support. If the sources disagree, say so.`

const synthesiseSystem = (deep: boolean): string => `You are writing a research brief that will be placed inside someone's document.
Structure:
1. A short opening paragraph that states the finding, not the topic.
2. Three to six sections with Markdown headings, each making a claim and backing it.
3. Where the sources disagree or the evidence is thin, say so plainly.
4. Close with "What this leaves open" — two or three specific open questions.
Rules:
- Cite every factual sentence with [n] matching the numbered sources you were given.
- Do not cite a source for something it does not say.
- No title page, no "Introduction" heading, no restating the instructions.
- ${deep ? 'This is a deep brief: 900-1400 words, with mechanism-level detail.' : 'Keep it tight: 500-800 words.'}`

/* ---------------- the paid path ---------------- */

interface ChargeResult {
  daily: number
  purchased: number
  total: number
  cost: number
}

type Charge = (cost: number, stage: string) => Promise<ChargeResult>

function chargeFrom(supa: Supa, profile: string): Charge {
  return async (cost, stage) => {
    return rpc<ChargeResult>(
      supa,
      'indra_spend_ai',
      { p_user: profile, p_cost: cost, p_meta: { source: 'edge', stage } },
      supa.service
    )
  }
}

function isInsufficient(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return text.includes('insufficient_tokens') || text.includes('insufficient_credits')
}

interface Body {
  mode?: unknown
  prompt?: unknown
  document?: unknown
  documentTitle?: unknown
  selection?: unknown
  depth?: unknown
  language?: unknown
  history?: unknown
}

function str(value: unknown, limit: number): string {
  return typeof value === 'string' ? clamp(value, limit) : ''
}

function historyOf(value: unknown): { role: 'user' | 'model'; text: string }[] {
  if (!Array.isArray(value)) return []
  const turns: { role: 'user' | 'model'; text: string }[] = []
  for (const item of value.slice(-8)) {
    if (!item || typeof item !== 'object') continue
    const row = item as { role?: unknown; text?: unknown }
    if (typeof row.text !== 'string' || !row.text.trim()) continue
    turns.push({ role: row.role === 'model' ? 'model' : 'user', text: clamp(row.text, 4000) })
  }
  return turns
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.')

  const startedAt = Date.now()
  const supa = env()
  const key = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_API_KEY') ?? ''
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()

  if (!token) return fail(401, 'unauthorized', 'Sign in to the cloud first.')

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return fail(400, 'bad_request', 'That request could not be read.')
  }

  const mode = body.mode === 'research' ? 'research' : 'chat'
  const prompt = str(body.prompt, 8000)
  if (!prompt) return fail(400, 'empty_prompt', 'Ask something first.')

  let user: { id: string }
  try {
    user = await caller(supa, token)
  } catch {
    return fail(401, 'unauthorized', 'That session has expired. Sign in to the cloud again.')
  }

  if (!key) {
    return fail(503, 'not_configured',
      'AI is not switched on for this workspace yet. The administrator has to add the model key to the cloud project.')
  }

  let profile: string
  try {
    profile = await profileOf(supa, user.id)
  } catch {
    return fail(409, 'no_profile', 'This account has no cloud profile yet. Open Cloud once, then try again.')
  }

  /* The balance is read before any work, so a person with nothing left is told
   * so instead of being charged into a negative number afterwards. */
  let balance: Record<string, unknown>
  try {
    balance = await rpc<Record<string, unknown>>(supa, 'indra_credit_state', {}, token)
  } catch (error) {
    return fail(409, 'no_profile', 'This account has no cloud profile yet. Open Cloud once, then try again.',
      { detail: error instanceof Error ? error.message : undefined })
  }
  /*
   * A floor, in tokens, before any provider call is made. A chat turn needs at
   * least a couple of thousand tokens in and out to be worth starting; research
   * reads several pages, so it needs more. Failing here costs nothing, whereas
   * starting a run the balance cannot pay for wastes a provider call and then
   * fails at the charge.
   */
  const available = Number(balance.total ?? 0)
  const minimum = mode === 'research' ? 4000 : 800
  if (available < minimum) {
    return fail(402, 'insufficient_tokens',
      mode === 'research'
        ? `Deep research needs about ${minimum.toLocaleString()} tokens free. This account has ${available.toLocaleString()}, and the allowance resets at midnight UTC.`
        : `This run needs about ${minimum.toLocaleString()} tokens free. This account has ${available.toLocaleString()}, and the allowance resets at midnight UTC.`,
      { balance, minimum, unit: 'tokens' })
  }

  const charge = chargeFrom(supa, profile)
  const trace: TraceEntry[] = []
  const usage: Usage = { prompt: 0, output: 0, total: 0, cost: 0 }
  let exhausted = false

  const timed = async (stage: string, run: () => Promise<TurnResult>): Promise<TurnResult | null> => {
    const at = Date.now()
    const result = await run()
    usage.prompt += result.usage.prompt
    usage.output += result.usage.output
    usage.total += result.usage.total
    try {
      await charge(result.usage.cost, stage)
      usage.cost += result.usage.cost
      trace.push({ stage, ms: Date.now() - at, tokens: result.usage.total, credits: result.usage.cost })
    } catch (error) {
      if (!isInsufficient(error)) throw error
      exhausted = true
      trace.push({ stage, ms: Date.now() - at, tokens: result.usage.total, credits: 0 })
    }
    return result
  }

  const document = str(body.document, MAX_INPUT_CHARS)
  const title = str(body.documentTitle, 200)
  const selection = str(body.selection, 6000)
  const language = str(body.language, 40)
  const history = historyOf(body.history)

  try {
    if (mode === 'chat') {
      const context = [
        title ? `Document: ${title}` : '',
        document ? `Document text:\n"""\n${document}\n"""` : '',
        selection ? `The person has selected this passage:\n"""\n${selection}\n"""` : '',
        history.length ? `Earlier in this conversation:\n${history.map((h) => `${h.role === 'user' ? 'Person' : 'You'}: ${h.text}`).join('\n')}` : '',
        language ? `Write in ${language}.` : '',
        `Request: ${prompt}`
      ].filter(Boolean).join('\n\n')

      const result = await timed('chat', () => turn({
        key,
        model: MODELS.chat,
        system: CHAT_SYSTEM,
        prompt: context,
        grounded: false,
        temperature: 0.7,
        maxOutputTokens: 2400,
        json: false,
        timeoutMs: 60_000,
      }))

      const state = await rpc<Record<string, unknown>>(supa, 'indra_credit_state', {}, token).catch(() => balance)
      return reply({
        ok: true,
        mode,
        model: MODELS.chat,
        answer: result?.text ?? '',
        citations: result?.citations ?? [],
        usage,
        balance: state,
        exhausted,
        trace,
        ms: Date.now() - startedAt
      })
    }

    /* ---- research ---- */
    const deep = body.depth === 'deep'
    const gap = Date.now() - startedAt > TOTAL_BUDGET_MS * 0.5
    const plan = await timed('plan', () => turn({
      key,
      model: MODELS.plan,
      system: PLAN_SYSTEM,
      prompt: [
        title ? `Document: ${title}` : '',
        document ? `Existing text:\n"""\n${document.slice(0, 8000)}\n"""` : '',
        `Topic to research: ${prompt}`,
        gap ? 'Keep the plan to exactly 3 questions.' : ''
      ].filter(Boolean).join('\n\n'),
      grounded: false,
      temperature: 0.4,
      maxOutputTokens: 700,
      json: true,
      timeoutMs: 30_000,
    }))

    let questions: string[] = []
    let angle = ''
    try {
      const parsed = JSON.parse(plan?.text ?? '{}') as { questions?: unknown; angle?: unknown }
      if (Array.isArray(parsed.questions)) {
        questions = parsed.questions
          .filter((q): q is string => typeof q === 'string' && q.trim().length > 8)
          .slice(0, deep ? 6 : 3)
          .map((q) => q.trim())
      }
      angle = typeof parsed.angle === 'string' ? parsed.angle.trim() : ''
    } catch {
      questions = []
    }
    if (!questions.length) questions = [prompt]

    /*
     * A spend that fails for want of balance stops the run here.
     *
     * Without this, the plan call could exhaust the balance and the searches
     * and synthesis would still be sent — five or six provider calls the owner
     * pays for and the person's balance never covers. Research is the expensive
     * mode, so this is where that leak costs the most.
     */
    if (exhausted) {
      const state = await rpc<Record<string, unknown>>(supa, 'indra_credit_state', {}, token).catch(() => balance)
      return reply({
        ok: true,
        mode,
        model: MODELS.plan,
        answer: '',
        outline: questions,
        angle,
        citations: [],
        usage,
        balance: state,
        exhausted,
        trace,
        ms: Date.now() - startedAt
      })
    }

    const searches = await Promise.all(questions.map((question, index) => timed(`search:${index + 1}`, () => turn({
      key,
      model: MODELS.search,
      system: SEARCH_SYSTEM,
      prompt: `${question}\n\nToday is ${new Date().toISOString().slice(0, 10)}.`,
      grounded: true,
      temperature: 0.3,
      maxOutputTokens: 1200,
      json: false,
      timeoutMs: SEARCH_TIMEOUT_MS,
    }))))

    const sources: Citation[] = []
    const evidence: string[] = []
    for (let index = 0; index < searches.length; index += 1) {
      const found = searches[index]
      if (!found) continue
      const numbers: number[] = []
      for (const citation of found.citations) {
        let position = sources.findIndex((known) => known.url === citation.url)
        if (position === -1) {
          sources.push(citation)
          position = sources.length - 1
        }
        numbers.push(position + 1)
      }
      evidence.push(
        `Question ${index + 1}: ${questions[index]}\nAnswer: ${found.text || '(no answer)'}` +
        (numbers.length ? `\nSources available for this question: ${numbers.map((n) => `[${n}]`).join(' ')}` : '')
      )
    }

    const sourceList = sources.map((source, index) => `[${index + 1}] ${source.title} — ${source.url}`).join('\n')
    const brief = [
      title ? `Document: ${title}` : '',
      angle ? `Through-line: ${angle}` : '',
      document ? `The document so far:\n"""\n${document.slice(0, 6000)}\n"""` : '',
      `Topic: ${prompt}`,
      `Research questions:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`,
      `Findings:\n${evidence.join('\n\n')}`,
      sourceList ? `Sources (cite by number only):\n${sourceList}` : 'No sources were retrieved; write only what the findings support and say where the evidence is thin.',
      language ? `Write in ${language}.` : ''
    ].filter(Boolean).join('\n\n')

    const synthesis = exhausted ? null : await timed('synthesis', () => turn({
      key,
      model: deep ? MODELS.research : MODELS.search,
      system: synthesiseSystem(deep),
      prompt: brief,
      grounded: false,
      temperature: 0.5,
      maxOutputTokens: deep ? 4000 : 2400,
      json: false,
      timeoutMs: deep ? 80_000 : 55_000,
    }))

    const state = await rpc<Record<string, unknown>>(supa, 'indra_credit_state', {}, token).catch(() => balance)
    return reply({
      ok: true,
      mode,
      model: deep ? MODELS.research : MODELS.search,
      answer: synthesis?.text ?? '',
      outline: questions,
      angle,
      citations: sources,
      usage,
      balance: state,
      exhausted,
      trace,
      ms: Date.now() - startedAt
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('provider:')) {
      return fail(502, 'provider_error', message.replace(/^provider:\s*/, ''), { usage, trace })
    }
    if (/aborted|AbortError|took too long/i.test(message)) {
      return fail(504, 'timeout', 'The model took too long. Try again, or ask for a narrower piece of research.', { usage, trace })
    }
    return fail(500, 'failed', 'The research run failed before it could finish.', { detail: message.slice(0, 300), usage, trace })
  }
})
