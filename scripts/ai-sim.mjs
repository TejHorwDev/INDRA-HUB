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

  const plans = [
    { id: 'free', name: 'Free', blurb: 'The daily habit.', daily_credits: 100, price_inr: 0, sort: 1 },
    { id: 'basic', name: 'Basic', blurb: 'More room to research.', daily_credits: 600, price_inr: 299, sort: 2 },
    { id: 'pro', name: 'Pro', blurb: 'Deep work, every day.', daily_credits: 2500, price_inr: 899, sort: 3 }
  ]

  const ledger = []
  const purchases = [
    {
      id: 'req-1',
      kind: 'plan',
      plan_id: 'basic',
      credits: null,
      amount_inr: 299,
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
      total: daily + purchased
    }
  }

  let chargeScript = []
  let lastAsk = null

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

      if (path === '/rest/v1/rpc/indra_credit_state') return json(200, stateBody())

      if (path === '/rest/v1/rpc/indra_my_ledger') return json(200, ledger.slice(0, body?.p_limit ?? 40))

      if (path === '/rest/v1/rpc/indra_my_purchases') return json(200, purchases)

      if (path === '/rest/v1/indra_plans') return json(200, plans)

      if (path === '/functions/v1/indra-ai') {
        lastAsk = { body, headers: init.headers ?? {} }
        const step = chargeScript.shift()
        if (step) return json(step.status, step.body)

        if (body.mode === 'research') {
          const searches = 3
          const cost = 1 + searches + 8
          if (!charge(cost)) {
            return json(402, { error: 'insufficient_credits', message: 'You have no credits left today.', balance: stateBody() })
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
          return json(402, { error: 'insufficient_credits', message: 'You have no credits left today.', balance: stateBody() })
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
  const offlineState = await api.creditsState(user, true)
  check(offlineState.connected === false, 'offline: no balance is invented', JSON.stringify(offlineState.total))
  check(
    /offline|connection/i.test(offlineState.message ?? ''),
    'offline: the reason is stated plainly',
    offlineState.message
  )

  globalThis.__online = true
  const live = await api.creditsState(user)
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
  check(broke === 'INSUFFICIENT_CREDITS', 'no credits is reported as no credits', broke)

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

  /* ---------------- the last known balance is drawn, not trusted ---------------- */

  const cachedLive = await api.creditsState(user)
  globalThis.__online = false
  const cached = await api.creditsState(user, true)
  check(cached.cached === true, 'with no route out the last known balance is served')
  check(cached.total === cachedLive.total, 'the cached figure is the one the server last confirmed')
  check(/last balance|refresh/i.test(cached.message ?? ''), 'the cached figure says what it is', cached.message)
  globalThis.__online = true

  const hidden = await api.creditsState(user, false)
  check(hidden.connected === true, 'with a route out the cache is not used')

  /* ---------------- the ledger and the requests ---------------- */

  const history = await api.creditLedger(user, 10)
  check(history.length >= 2 && history[0].kind === 'usage', 'the ledger is read from the server, newest first')
  check(history[0].amount < 0 && history[0].balanceAfter >= 0, 'a charge is negative and names the balance after it')

  const tiers = await api.creditPlans(user)
  check(tiers.length === 3 && tiers[1].priceInr === 299, 'the tiers come from the plan table')
  check(tiers.filter((plan) => plan.current).length === 1, 'exactly one tier is the current one')

  const requests = await api.purchaseRequests(user)
  check(requests.length === 1 && requests[0].planName === 'Basic', 'a request carries the tier it is for', requests[0]?.planName)

  /* ---------------- a member cannot administer credits ---------------- */

  const snapshot = await api.adminCreditSnapshot(user)
  check(snapshot.live === false, 'a normal account gets no credit console')
  check(snapshot.pending.length === 0 && snapshot.accounts.length === 0, 'and no other account’s numbers with it')
  check(/not an administrator/i.test(snapshot.message ?? ''), 'the refusal explains itself', snapshot.message)

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
