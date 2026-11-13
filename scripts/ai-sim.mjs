/**
 * Credits and the research path.
 *
 * The claim this file checks: the app never decides what a request costs, never
 * reports a balance it did not receive, and never reaches a model without the
 * server charging for it first.
 *
 * There is no real network here. `net.fetch` is answered by a stub that behaves
 * like the pieces the app actually talks to: GoTrue for the token, PostgREST for
 * `indra_credit_state` and the ledger, and the `indra-ai` Edge Function — which
 * in this stub charges the tokens it reports, exactly as the real one does
 * through `indra_spend_ai`. When the machine is "offline" the stub refuses
 * every call, which is how the offline behaviour is checked rather than assumed.
 *
 * What is *not* simulated: the database's own enforcement (no client can write
 * a balance) — that is SQL, verified against the live project, and it is the
 * reason the numbers below are only ever read.
 *
 *   npm run sim:ai
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-ai-sim')
const bundlePath = join(work, 'bundle.cjs')
const userData = join(work, 'userdata')

let failures = 0
const check = (pass, label, detail) => {
  if (pass) console.log(`✓ ${label}`)
  else {
    failures += 1
    console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

const refused = async (run) => {
  try {
    await run()
    return ''
  } catch (error) {
    return String(error?.code ?? error?.message ?? error)
  }
}

async function main() {
  rmSync(work, { recursive: true, force: true })
  mkdirSync(userData, { recursive: true })
  mkdirSync(join(work, 'node_modules', 'electron'), { recursive: true })

  writeFileSync(
    join(work, 'node_modules', 'electron', 'package.json'),
    JSON.stringify({ name: 'electron', version: '45.0.0', main: 'index.js' })
  )
  writeFileSync(
    join(work, 'node_modules', 'electron', 'index.js'),
    `const calls = []
globalThis.__aiCalls = calls
const app = {
  isPackaged: true,
  getVersion: () => '2.0.0',
  getPath: () => globalThis.__userData,
  relaunch: () => {},
  exit: () => {}
}
const net = {
  isOnline: () => globalThis.__online !== false,
  fetch: async (url, init = {}) => {
    if (globalThis.__online === false) throw new Error('offline')
    calls.push({
      url: String(url),
      method: (init.method || 'GET').toUpperCase(),
      body: init.body ? JSON.parse(init.body) : undefined,
      headers: init.headers || {}
    })
    return globalThis.__aiServer.handle(String(url), init)
  }
}
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(Buffer.from(value, 'utf8').toString('base64').split('').reverse().join(''), 'utf8'),
  decryptString: (buffer) => Buffer.from(buffer.toString('utf8').split('').reverse().join(''), 'base64').toString('utf8')
}
const dialog = { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }) }
const BrowserWindow = { getAllWindows: () => [], fromWebContents: () => null }
module.exports = { app, net, safeStorage, dialog, BrowserWindow, nativeTheme: { shouldUseDarkColors: true, on: () => {} }, shell: { openExternal: () => {} }, ipcMain: { handle: () => {} } }
`
  )

  writeFileSync(
    join(work, 'entry.ts'),
    `export * from ${JSON.stringify(join(root, 'src/main/services/auth.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/projects.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/documents.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/ai.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/db/database.ts'))}
`
  )

  await build({
    entryPoints: [join(work, 'entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'node:sqlite'],
    outfile: bundlePath,
    logLevel: 'warning'
  })

  const require = createRequire(join(work, 'index.js'))
  require('electron')
  const api = require(bundlePath)

  globalThis.__userData = userData
  globalThis.__online = true

  /* ---------------- the stub cloud ---------------- */

  const users = new Map()
  const profiles = new Map()
  const tokens = new Map()
  let seq = 0

  const balance = {
    plan: 'free',
    planName: 'Free',
    daily: 100,
    purchased: 0,
    dailyAllowance: 100,
    spentToday: 0,
    requestsToday: 0,
    resetAt: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    planExpiresAt: null,
    isAdmin: false
  }

  /*
   * The workspace prices in dollars now, and a tier carries a currency-neutral
   * `price_minor` plus an `enabled` switch. The stub says what the server says,
   * so the app is exercised against the real shape.
   */
  const plans = [
    { id: 'free', name: 'Free', blurb: 'The daily habit.', daily_tokens: 10000, price_minor: 0, enabled: true, sort: 1 },
    { id: 'basic', name: 'Basic', blurb: 'More room to research.', daily_tokens: 40000, price_minor: 399, enabled: true, sort: 2 },
    { id: 'pro', name: 'Pro', blurb: 'Deep work, every day.', daily_tokens: 120000, price_minor: 999, enabled: true, sort: 3 }
  ]

  const creditSettings = {
    currency: 'USD',
    symbol: '$',
    decimals: 2,
    topupTokens: 100000,
    topupPriceMinor: 10000,
    minTopup: 100000,
    maxTopup: 100000000,
    lowBalance: 3000,
    updatedAt: new Date().toISOString()
  }

  const ledger = []
  const purchases = [
    {
      id: 'req-1',
      kind: 'plan',
      plan_id: 'basic',
      credits: null,
      amount_minor: 399,
      currency: 'USD',
      status: 'pending',
      note: 'testing',
      created_at: new Date().toISOString(),
      decided_at: null
    }
  ]

  const json = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body))
  })

  const stateBody = () => {
    const { plan, planName, daily, purchased, dailyAllowance, spentToday, requestsToday, resetAt, planExpiresAt, isAdmin } = balance
    return {
      plan,
      planName,
      daily,
      purchased,
      dailyAllowance,
      spentToday,
      requestsToday,
      resetAt,
      planExpiresAt,
      isAdmin,
      settings: creditSettings,
      total: daily + purchased
    }
  }

  let chargeScript = []
  let lastAsk = null

  /*
   * One more account, so the console has something to act on that is not the
   * caller: suspension and the per-account view are refused on yourself, which
   * is itself a rule worth exercising rather than working around.
   */
  const otherAccount = {
    id: 'profile-other',
    display_name: 'Second Writer',
    username: 'second',
    email: 'second@example.com',
    plan: 'free',
    plan_name: 'Free',
    daily: '100',
    purchased: '0',
    total: 100,
    requests: 0,
    plan_expires_at: null,
    last_sign_in_at: new Date().toISOString(),
    suspended_at: null
  }
  const suspension = new Map()
  const spendRows = []

  const charge = (cost) => {
    if (balance.daily + balance.purchased < cost) return false
    const fromDaily = Math.min(balance.daily, cost)
    balance.daily -= fromDaily
    balance.purchased -= cost - fromDaily
    balance.spentToday += cost
    balance.requestsToday += 1
    ledger.unshift({
      id: `l-${++seq}`,
      kind: 'usage',
      amount: -cost,
      balance_after: balance.daily + balance.purchased,
      meta: { source: 'edge', stage: 'chat' },
      created_at: new Date().toISOString()
    })
    return true
  }

  globalThis.__aiServer = {
    state: () => stateBody(),
    plans: () => plans.map((plan) => ({ ...plan })),
    settings: () => ({ ...creditSettings }),
    setBalance: (patch) => Object.assign(balance, patch),
    setChargeScript: (script) => {
      chargeScript = script
    },
    lastAsk: () => lastAsk,
    handle(rawUrl, init = {}) {
      const url = new URL(rawUrl)
      const path = url.pathname
      const body = init.body ? JSON.parse(init.body) : undefined
      const token = (init.headers?.auth ?? init.headers?.Authorization ?? init.headers?.authorization ?? '').replace(/^Bearer\s+/, '')

      if (path === '/auth/v1/signup') {
        const uid = `auth-${++seq}`
        users.set(uid, body.email)
        profiles.set(uid, `profile-${seq}`)
        const access = `access-${seq}`
        tokens.set(access, uid)
        return json(200, {
          access_token: access,
          refresh_token: `refresh-${seq}`,
          expires_in: 3600,
          user: { id: uid, email: body.email }
        })
      }

      if (path === '/rest/v1/indra_users') {
        const uid = tokens.get(token)
        if (!uid) return json(401, { message: 'no session' })
        return json(200, [{ id: profiles.get(uid) ?? 'profile-0' }])
      }

      if (!tokens.has(token)) return json(401, { message: 'no session' })

      if (path === '/rest/v1/rpc/indra_credit_state') {
        /* Someone else may hold the role while this PC does not. */
        return json(200, { ...stateBody(), isAdmin: globalThis.__aiIsAdmin ?? balance.isAdmin })
      }

      if (path === '/rest/v1/rpc/indra_my_ledger') return json(200, ledger.slice(0, body?.p_limit ?? 40))

      if (path === '/rest/v1/rpc/indra_my_purchases') return json(200, purchases)

      if (path === '/rest/v1/indra_plans') return json(200, plans)

      if (path === '/rest/v1/rpc/indra_request_purchase') {
        /*
         * The server prices a request; the stub does the same arithmetic from
         * its own settings, so a client that invented a price would disagree
         * with the receipt it gets back.
         */
        const kind = body?.p_kind
        const amount =
          kind === 'plan'
            ? (plans.find((plan) => plan.id === body?.p_plan)?.price_minor ?? 0)
            : Math.ceil(Number(body?.p_tokens ?? body?.p_credits ?? 0) / creditSettings.topupTokens) *
              creditSettings.topupPriceMinor
        purchases.unshift({
          id: `req-${++seq}`,
          kind,
          plan_id: kind === 'plan' ? body?.p_plan : null,
          plan_name: kind === 'plan' ? (plans.find((plan) => plan.id === body?.p_plan)?.name ?? null) : null,
          credits: kind === 'credits' ? Number(body?.p_tokens ?? body?.p_credits ?? 0) : null,
          amount_minor: amount,
          currency: creditSettings.currency,
          status: 'pending',
          note: body?.p_note ?? '',
          created_at: new Date().toISOString(),
          decided_at: null
        })
        return json(200, `req-${seq}`)
      }

      if (path === '/rest/v1/rpc/indra_admin_update_credit_settings') {
        Object.assign(creditSettings, {
          currency: body?.p_currency ?? creditSettings.currency,
          symbol: body?.p_symbol ?? creditSettings.symbol,
          decimals: body?.p_decimals ?? creditSettings.decimals,
          topupTokens: body?.p_topup_tokens ?? creditSettings.topupTokens,
          topupPriceMinor: body?.p_topup_price_minor ?? creditSettings.topupPriceMinor,
          minTopup: body?.p_min_topup ?? creditSettings.minTopup,
          maxTopup: body?.p_max_topup ?? creditSettings.maxTopup,
          lowBalance: body?.p_low_balance ?? creditSettings.lowBalance,
          updatedAt: new Date().toISOString()
        })
        return json(200, creditSettings)
      }

      if (path === '/rest/v1/rpc/indra_admin_save_plan') {
        const plan = plans.find((entry) => entry.id === body?.p_id)
        if (!plan) return json(404, { message: 'That plan does not exist.' })
        if (body?.p_name !== null && body?.p_name !== undefined) plan.name = body.p_name
        if (body?.p_daily !== null && body?.p_daily !== undefined) plan.daily_tokens = body.p_daily
        if (body?.p_price_minor !== null && body?.p_price_minor !== undefined) plan.price_minor = body.p_price_minor
        if (body?.p_enabled !== null && body?.p_enabled !== undefined) plan.enabled = body.p_enabled
        return json(200, { id: plan.id, created: false })
      }

      /*
       * The console's own reads and writes, answered with the shapes the real
       * functions return. The caller's balance is the stub's own `balance`, so a
       * grant made here shows up in the next balance read — the same thing the
       * database does.
       */
      /*
       * Only the console's own calls are gated. Everything else — the ledger, the
       * Edge Function, a member's own balance — belongs to the member paths and
       * must keep working while this switch is off.
       */
      if (
        /\/rpc\/indra_admin_(accounts|ledgers?|decide_purchase|set_plan|suspend|refill)/.test(path) &&
        !balance.isAdmin
      ) {
        return json(403, { message: 'Only an administrator can do that.' })
      }

      /*
       * Taking the role, answered the way the server answers it after this fix:
       * granted when nobody else is live, refused with a reason when somebody
       * is. The sim flips `__aiRoleHeldElsewhere` to exercise both.
       */
      if (path === '/rest/v1/rpc/indra_admin_claim') {
        if (globalThis.__aiClaimRawError) {
          return json(400, {
            code: 'P0001',
            details: null,
            hint: null,
            message: 'A device cannot be an administrator. Sign in with the account that should run this console.'
          })
        }
        if (globalThis.__aiRoleHeldElsewhere) {
          return json(200, {
            claimed: false,
            adminEmail: 'someone@example.com',
            reason: 'Another account already administers this installation.'
          })
        }
        balance.isAdmin = true
        globalThis.__aiIsAdmin = true
        return json(200, { claimed: true, adminEmail: 'admin@example.com', reason: null })
      }

      /* Who administers, asked before anything is claimed. */
      if (path === '/rest/v1/rpc/indra_admin_who') {
        return json(200, balance.isAdmin ? { email: 'admin@example.com' } : null)
      }

      if (path === '/rest/v1/rpc/indra_credit_reset_info') {
        return json(200, {
          nextResetAt: new Date(Date.now() + 6 * 3_600_000).toISOString(),
          lastRefillAt: new Date(Date.now() - 18 * 3_600_000).toISOString(),
          schedule: '5 0 * * *',
          totalAccounts: 2,
          suspendedAccounts: suspension.size
        })
      }

      if (path === '/rest/v1/rpc/indra_admin_purchases') return json(200, purchases)

      if (path === '/rest/v1/rpc/indra_admin_accounts') {
        return json(200, [
          {
            id: 'profile-me',
            display_name: 'Writer',
            username: 'writer',
            email: 'writer@example.com',
            plan: balance.plan,
            plan_name: balance.planName,
            daily: String(balance.daily),
            purchased: String(balance.purchased),
            total: balance.daily + balance.purchased,
            requests: balance.requestsToday,
            plan_expires_at: null,
            last_sign_in_at: new Date().toISOString(),
            suspended_at: suspension.get('profile-me') ?? null
          },
          { ...otherAccount }
        ])
      }

      if (path === '/rest/v1/rpc/indra_admin_spend_log') {
        return json(200, spendRows.slice(0, body?.p_limit ?? 60))
      }

      if (path === '/rest/v1/rpc/indra_admin_account') {
        if (body?.p_user === 'profile-other') {
          return json(200, {
            account: { ...otherAccount, suspended_at: suspension.get('profile-other') ?? null },
            ledger: [
              {
                id: 'l-other-1',
                kind: 'grant',
                amount: 250,
                balance_after: 350,
                meta: { note: 'console test' },
                created_at: new Date().toISOString()
              }
            ]
          })
        }
        return json(200, {
          account: {
            id: 'profile-me',
            display_name: 'Writer',
            plan: balance.plan,
            plan_name: balance.planName,
            daily: balance.daily,
            purchased: balance.purchased,
            total: balance.daily + balance.purchased,
            requests: balance.requestsToday,
            suspended_at: null
          },
          ledger
        })
      }

      if (path === '/rest/v1/rpc/indra_admin_grant_credits') {
        const amount = Number(body?.p_amount ?? 0)
        balance.purchased += amount
        const movement = {
          id: `l-${++seq}`,
          user_id: 'profile-me',
          display_name: 'Writer',
          kind: 'grant',
          amount,
          balance_after: balance.daily + balance.purchased,
          meta: { note: body?.p_note ?? '' },
          created_at: new Date().toISOString()
        }
        ledger.unshift(movement)
        spendRows.unshift(movement)
        return json(200, { ok: true, balance: balance.daily + balance.purchased })
      }

      if (path === '/rest/v1/rpc/indra_admin_set_suspended') {
        if (body?.p_user === 'profile-me') {
          return json(400, { message: 'An administrator cannot suspend their own account.' })
        }
        if (body?.p_suspended === false) suspension.delete(body?.p_user)
        else suspension.set(body?.p_user, new Date().toISOString())
        return json(200, { ok: true })
      }

      if (path === '/rest/v1/rpc/indra_admin_reset_daily') {
        spendRows.unshift({
          id: `l-${++seq}`,
          user_id: 'profile-other',
          display_name: 'Second Writer',
          kind: 'refill',
          amount: 100,
          balance_after: 200,
          meta: { reason: 'administrator refill' },
          created_at: new Date().toISOString()
        })
        return json(200, 1)
      }

      if (path === '/functions/v1/indra-ai') {
        lastAsk = { body, headers: init.headers ?? {} }
        const step = chargeScript.shift()
        if (step) return json(step.status, step.body)

        if (body.mode === 'research') {
          const searches = 3
          const cost = 1 + searches + 8
          if (!charge(cost)) {
            return json(402, { error: 'insufficient_tokens', message: 'You have no tokens left today.', balance: stateBody() })
          }
          return json(200, {
            ok: true,
            mode: 'research',
            model: 'gemini-2.5-flash',
            answer:
              '# Why storage economics changed\n\nGrid-scale batteries became cheap enough to arbitrage daily peaks [1].\n\n## What this leaves open\n\nWho pays for the transmission upgrade. [2]',
            outline: ['What does a battery earn per cycle?', 'How fast did cell prices fall?', 'Where is the counter-argument?'],
            angle: 'Costs fell faster than the market rules adapted.',
            citations: [
              { title: 'Grid storage costs 2025', url: 'https://example.org/storage-costs' },
              { title: 'Transmission and storage', url: 'https://example.org/transmission' }
            ],
            usage: { prompt: 5200, output: 2100, total: 7300, cost },
            balance: stateBody(),
            exhausted: false,
            trace: [{ stage: 'synthesis', ms: 4200, tokens: 7300, credits: cost }],
            ms: 61000
          })
        }

        const cost = 2
        if (!charge(cost)) {
          return json(402, { error: 'insufficient_tokens', message: 'You have no tokens left today.', balance: stateBody() })
        }
        return json(200, {
          ok: true,
          mode: 'chat',
          model: 'gemini-2.5-flash',
          answer: 'A tighter opening: the argument starts with the number, not the context.',
          citations: [],
          usage: { prompt: 1500, output: 500, total: 2000, cost },
          balance: stateBody(),
          exhausted: false,
          trace: [{ stage: 'chat', ms: 2100, tokens: 2000, credits: cost }],
          ms: 2400
        })
      }

      return json(404, { message: `unhandled ${path}` })
    }
  }

  /* ---------------- a real account, a real document ---------------- */

  const user = api.register({
    username: 'writer',
    displayName: 'Writer',
    email: 'writer@example.com',
    password: 'Str0ng-pass!'
  })
  const project = api.createProject(user, { name: 'The storage piece' })
  const document = api.createDocument(user, project.id, 'Storage economics')
  api.saveDocument(user, project.id, document.id, {
    blocks: [
      { id: 'b1', type: 'heading1', html: 'Storage economics' },
      { id: 'b2', type: 'paragraph', html: 'Batteries are displacing peaking plants in <strong>India</strong>.' }
    ],
    baseVersion: 1
  })

  /* ---------------- the balance is read, never assumed ---------------- */

  globalThis.__online = false
  const offlineState = await api.tokensState(user, true)
  check(offlineState.connected === false, 'offline: no balance is invented', JSON.stringify(offlineState.total))
  check(
    /offline|connection/i.test(offlineState.message ?? ''),
    'offline: the reason is stated plainly',
    offlineState.message
  )

  globalThis.__online = true
  const live = await api.tokensState(user)
  check(live.connected === true && live.total === 100, 'the balance comes from the server', String(live.total))
  check(live.planName === 'Free' && live.dailyAllowance === 100, 'the plan and allowance are the server’s')
  check(Boolean(live.syncedAt) && live.cached === false, 'a live read is marked as live')

  /* ---------------- writing with the document in view ---------------- */

  const drafted = await api.ask(
    user,
    { projectId: project.id, documentId: document.id, prompt: 'Tighten the opening.', selection: 'Batteries are displacing peaking plants' },
    'chat'
  )
  check(drafted.answer.length > 0, 'a writing turn returns the model’s text')
  check(drafted.usage.cost === 2 && drafted.usage.total === 2000, 'the cost is what the server charged')
  check(drafted.balance?.total === 98, 'the balance after the turn is the server’s answer', String(drafted.balance?.total))

  const sent = globalThis.__aiServer.lastAsk()
  check(
    String(sent?.body?.document ?? '').includes('Batteries are displacing peaking plants'),
    'the document itself is sent, not just the question'
  )
  check(String(sent?.body?.selection ?? '').includes('Batteries'), 'the selection is sent when there is one')
  check(
    !JSON.stringify(sent?.headers ?? {}).toLowerCase().includes('goog') &&
      !JSON.stringify(sent?.body ?? {}).toLowerCase().includes('api_key'),
    'no provider key leaves the app — there isn’t one to send'
  )

  const runs = api.activity(user, 10)
  check(runs.length === 1 && runs[0].credits === 2, 'the run is recorded locally with its real cost')
  check(runs[0].documentTitle === 'Storage economics', 'the record names the document')

  /* ---------------- research: questions, sources, a brief ---------------- */

  const researched = await api.ask(
    user,
    { projectId: project.id, documentId: document.id, prompt: 'Economics of grid-scale storage in India', depth: 'deep' },
    'research'
  )
  check(researched.outline.length === 3, 'research plans the questions it works through')
  check(researched.citations.length === 2, 'every source it used comes back with a URL')
  check(/^https:\/\//.test(researched.citations[0].url), 'the sources are real links, not labels')
  check(researched.mode === 'research' && researched.usage.cost === 12, 'a research run is charged by its tokens')
  check(globalThis.__aiServer.lastAsk().body.depth === 'deep', 'the requested depth reaches the server')

  /* ---------------- every refusal is a real refusal ---------------- */

  const empty = await refused(() => api.ask(user, { projectId: project.id, documentId: document.id, prompt: '  ' }, 'chat'))
  check(empty === 'VALIDATION', 'an empty question is refused before any request', empty)

  globalThis.__aiServer.setBalance({ daily: 0, purchased: 0 })
  const broke = await refused(() =>
    api.ask(user, { projectId: project.id, documentId: document.id, prompt: 'One more' }, 'chat')
  )
  check(broke === 'INSUFFICIENT_TOKENS', 'no tokens is reported as no tokens', broke)

  globalThis.__aiServer.setBalance({ daily: 100 })
  globalThis.__aiServer.setChargeScript([
    { status: 503, body: { error: 'not_configured', message: 'AI is not switched on for this workspace yet.' } }
  ])
  const unconfigured = await refused(() =>
    api.ask(user, { projectId: project.id, documentId: document.id, prompt: 'Hello' }, 'chat')
  )
  check(unconfigured === 'AI_UNAVAILABLE', 'a workspace with no key says so', unconfigured)

  globalThis.__aiServer.setChargeScript([{ status: 401, body: { error: 'unauthorized' } }])
  const expired = await refused(() =>
    api.ask(user, { projectId: project.id, documentId: document.id, prompt: 'Hello' }, 'chat')
  )
  check(expired === 'AUTH_REQUIRED', 'an expired session is not treated as a failed run', expired)
  globalThis.__aiServer.setChargeScript([])

  globalThis.__online = false
  const wentOffline = await refused(() =>
    api.ask(user, { projectId: project.id, documentId: document.id, prompt: 'Offline?' }, 'chat')
  )
  check(wentOffline !== '', 'offline, a run is refused instead of queued', wentOffline)
  globalThis.__online = true

  /* ---------------- there is no local balance, by design ---------------- */

  globalThis.__online = false
  const offlineRead = await api.tokensState(user)
  check(offlineRead.connected === false, 'offline, no balance is served at all')
  check(offlineRead.total === 0, 'offline, the number is zero rather than a stale copy')
  check(offlineRead.cached === false, 'offline, nothing is presented as a cached balance')
  check(/offline/i.test(offlineRead.message ?? ''), 'offline says why there is no number', offlineRead.message)
  globalThis.__online = true

  const hidden = await api.tokensState(user)
  check(hidden.connected === true, 'with a route out the balance is read live')

  /* ---------------- the ledger and the requests ---------------- */

  const history = await api.tokenLedger(user, 10)
  check(history.length >= 2 && history[0].kind === 'usage', 'the ledger is read from the server, newest first')
  check(history[0].amount < 0 && history[0].balanceAfter >= 0, 'a charge is negative and names the balance after it')

  const tiers = await api.tokenPlans(user)
  check(tiers.length === 3 && tiers[1].priceMinor === 399, 'the tiers come from the plan table')
  check(tiers.filter((plan) => plan.current).length === 1, 'exactly one tier is the current one')
  check(
    tiers.every((plan) => typeof plan.enabled === 'boolean'),
    'a tier says whether it is offered'
  )

  /* ---------------- the pricing rules are the server's ---------------- */

  const rules = live.settings
  check(
    rules?.currency === 'USD' && rules?.symbol === '$' && rules?.decimals === 2,
    'the workspace currency arrives with the balance',
    JSON.stringify(rules)
  )
  check(
    rules?.topupTokens === 100000 && rules?.topupPriceMinor === 10000,
    'what a pack holds, and what it costs, are the server settings'
  )
  check(
    rules?.minTopup === 100000 && rules?.maxTopup === 100000000 && rules?.lowBalance === 3000,
    'the top-up limits and the low-balance mark are settings, not constants'
  )

  /* A top-up is priced by the server: 200,000 tokens at 100,000 per $100 pack is two packs. */
  const priced = await api.requestPurchase(user, { kind: 'topup', tokens: 200_000, note: '' })
  const pricedRequest = priced.find((request) => request.kind === 'topup')
  check(
    pricedRequest?.amountMinor === 20000 && pricedRequest?.currency === 'USD',
    'a top-up is priced in whole minor units by the server',
    JSON.stringify({ amount: pricedRequest?.amountMinor, currency: pricedRequest?.currency })
  )
  check(
    pricedRequest?.planName === null && pricedRequest?.tokens === 200_000,
    'a top-up request keeps the tokens it is for'
  )

  /* A tier request carries the tier's price and its name, straight from the row. */
  const planRequest = await api.requestPurchase(user, { kind: 'plan', planId: 'pro', note: '' })
  const proRequest = planRequest.find((request) => request.planId === 'pro')
  check(
    proRequest?.amountMinor === 999 && proRequest?.currency === 'USD' && proRequest?.planName === 'Pro',
    'a plan request carries the price and the name the server holds',
    JSON.stringify({ amount: proRequest?.amountMinor, name: proRequest?.planName })
  )

  /* ---------------- nothing here can write a price ---------------- */

  const pricedFromClient = globalThis.__aiCalls.filter(
    (call) => call.method === 'PATCH' && call.url.includes('indra_plans')
  )
  check(pricedFromClient.length === 0, 'the app never writes a plan row directly')

  const requests = await api.purchaseRequests(user)
  check(
    requests.some((request) => request.planName === 'Basic' && request.amountMinor === 399),
    'a request carries the tier it is for, and what it was quoted',
    JSON.stringify(requests.map((request) => [request.kind, request.planName, request.amountMinor]))
  )

  /* ---------------- a member cannot administer credits ---------------- */

  const snapshot = await api.adminTokenSnapshot(user)
  check(snapshot.live === false, 'a normal account gets no credit console')
  check(snapshot.pending.length === 0 && snapshot.accounts.length === 0, 'and no other account’s numbers with it')
  check(/administers/i.test(snapshot.message ?? ''), 'the refusal explains itself', snapshot.message)
  check(
    snapshot.accounts.length === 0 && snapshot.settings?.currency === 'USD',
    'a member may read the prices but nothing about another account'
  )

  /* ---------------- the console, as the administrator ---------------- */

  /*
   * Everything below is the panel's real path: the same functions the IPC
   * handlers call, against a stub that answers like the database. The point is
   * not that the numbers look nice — it is that each control reaches a function
   * that exists, sends the argument names the function declares, and reports
   * what came back instead of assuming.
   */

  balance.isAdmin = true

  const consoleState = await api.adminTokenSnapshot(user)
  check(consoleState.live === true && consoleState.reachable === true, 'an administrator gets the console', consoleState.message)
  check(consoleState.accounts.length === 2, 'every account is listed', String(consoleState.accounts.length))
  check(
    consoleState.reset?.totalAccounts === 2 && consoleState.reset?.schedule === '5 0 * * *',
    'the refill clock and the real account count come from the server',
    JSON.stringify(consoleState.reset)
  )
  check(
    consoleState.reset?.nextResetAt !== undefined && consoleState.reset?.lastRefillAt !== null,
    'the panel knows when the allowance next refills, and when it last did'
  )

  const granted = await api.adminGrant(user, 'profile-other', 250, 'console test')
  check(granted.accounts.length === 2, 'a grant returns the state after it, not a claim', String(granted.accounts?.length))
  const grantedCall = globalThis.__aiCalls.filter((call) => call.url.includes('indra_admin_grant_credits')).pop()
  check(
    grantedCall?.body?.p_user === 'profile-other' && grantedCall?.body?.p_amount === 250,
    'the grant sends the account and the amount the function declares',
    JSON.stringify(grantedCall?.body)
  )
  check(
    typeof grantedCall?.body?.p_reason === 'string',
    'and a reason, which is the argument name the function requires',
    JSON.stringify(Object.keys(grantedCall?.body ?? {}))
  )

  const detail = await api.adminAccountDetail(user, 'profile-other')
  check(detail.account.displayName === 'Second Writer', 'an account opens with its own facts', JSON.stringify(detail.account.displayName))
  check(detail.ledger.length === 1 && detail.ledger[0].kind === 'grant', 'and with its own history')

  const suspended = await api.adminSetSuspended(user, 'profile-other', true)
  check(suspended.accounts.length === 2, 'a suspension returns the state after it')
  // Exact, because `indra_admin_account` is a prefix of `indra_admin_accounts`
  // and a loose match would silently assert against the account *list* instead.
  const detailCall = globalThis.__aiCalls
    .filter((call) => call.url.endsWith('/rpc/indra_admin_account'))
    .pop()
  check(
    detailCall?.body?.p_user === 'profile-other',
    'the account view sends the account it is asking about',
    JSON.stringify(detailCall?.body)
  )

  const selfSuspend = await refused(() => api.adminSetSuspended(user, 'profile-me', true))
  check(/own account|self/i.test(selfSuspend), 'an administrator cannot suspend themselves', selfSuspend)

  const refilled = await api.adminResetDaily(user)
  check(
    refilled.refilled === 1 && refilled.snapshot?.live === true,
    'a fleet-wide refill says how many accounts it touched',
    JSON.stringify({ refilled: refilled.refilled, live: refilled.snapshot?.live })
  )

  const spend = await api.adminSpendLog(user, 60)
  check(spend.length >= 1, 'every movement is readable across accounts', String(spend.length))
  check(
    spend.some((row) => row.accountName === 'Writer' && row.kind === 'grant'),
    'a movement names the account it belongs to',
    JSON.stringify(spend.map((row) => [row.accountName, row.kind]))
  )

  /*
   * The reinstall case, which is the one that made the live panel useless: this
   * PC's identity is new, another identity still holds the role, and the old
   * one belongs to a machine that no longer exists. The panel has to be able to
   * say WHICH account it is, because "the role is not granted" is the same
   * sentence in every one of those situations.
   */
  check(
    consoleState.identity?.email !== null && consoleState.identity?.uid !== null,
    'the panel knows which cloud account this PC is speaking as',
    JSON.stringify(consoleState.identity)
  )

  /* ---------------- the reinstall: another PC still holds the role ---------------- */

  /*
   * This is the case that made the live panel useless after a reinstall. The
   * role is taken by an identity belonging to a PC that no longer exists, so the
   * button is refused — and the panel must say *why*, in the server's words,
   * instead of claiming that taking the role will fix it.
   */
  globalThis.__aiIsAdmin = false
  balance.isAdmin = false
  globalThis.__aiRoleHeldElsewhere = true

  const refusedClaim = await api.adminClaimTokenRole(user)
  check(refusedClaim.live === false, 'a role held elsewhere leaves the console read-only')
  check(
    /already administers this installation/i.test(refusedClaim.message ?? ''),
    'and the refusal is the server’s reason, not a guess',
    refusedClaim.message
  )

  /*
   * A refusal arrives as a PostgREST body. The panel used to print it verbatim —
   * {"code":"P0001","details":null,...} — which tells a person nothing they can
   * do. The server's own sentence is what has to survive.
   */
  globalThis.__aiClaimRawError = true
  const rawRefusal = await api.adminClaimTokenRole(user)
  check(
    !/[{}"]/.test(rawRefusal.message ?? ''),
    'a refusal is a sentence, not a JSON body',
    rawRefusal.message
  )
  check(
    /device cannot be an administrator/i.test(rawRefusal.message ?? ''),
    'and it is the server\'s own words'
  )
  globalThis.__aiClaimRawError = false

  /* Once the other installation is gone, the same press succeeds. */
  globalThis.__aiRoleHeldElsewhere = false
  const acceptedClaim = await api.adminClaimTokenRole(user)
  check(acceptedClaim.live === true, 'with no live administrator the press takes the role', acceptedClaim.message)
  check(acceptedClaim.claimed === true && acceptedClaim.accounts.length === 2, 'and the console opens in the same press')

  /* The console refuses to pretend: with the role gone, it says so. */
  balance.isAdmin = false
  globalThis.__aiIsAdmin = false
  const revoked = await api.adminTokenSnapshot(user)
  check(revoked.live === false && revoked.reachable === true, 'without the role the console is read-only, not broken')
  check(/administers/i.test(revoked.message ?? ''), 'and it says exactly that', revoked.message)
  balance.isAdmin = true
  globalThis.__aiIsAdmin = true

  /* ---------------- nothing was written to a balance from here ---------------- */

  const writes = globalThis.__aiCalls.filter(
    (call) =>
      call.method === 'PATCH' &&
      call.url.includes('indra_users') &&
      JSON.stringify(call.body ?? '').match(/daily_balance|purchased_balance/)
  )
  check(writes.length === 0, 'the app never writes a balance column')
  const spendFromClient = globalThis.__aiCalls.filter((call) => call.url.includes('indra_spend_ai'))
  check(spendFromClient.length === 0, 'the app never calls the charging function itself')

  console.log(
    failures === 0
      ? '\n✓ credits are server-enforced, research is real, and offline is honest'
      : `\n${failures} check(s) failed`
  )
  if (failures > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
})
