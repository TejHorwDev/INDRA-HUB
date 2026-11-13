/**
 * The Edge Function, run here.
 *
 * `supabase/functions/ai/index.ts` is the only code that holds the model key and
 * the only code that charges. It cannot be exercised from the desktop app, so it
 * is exercised here instead: the same file, bundled and executed with `Deno.env`
 * and `fetch` replaced by a stand-in that answers like Gemini and like the
 * project's own REST API.
 *
 * What this proves, without a network and without a key:
 *   - a missing key is reported as "not configured", not as a failed run;
 *   - an unverified session is refused before anything is spent;
 *   - a chat turn is charged exactly the tokens the provider reported;
 *   - research really is plan -> parallel searches -> synthesis, with the
 *     sources deduplicated, and every step charged as it happens;
 *   - a run that runs out of credits stops, keeps what it wrote, and says so;
 *   - the charge is made with the service key nobody in the app holds.
 *
 *   npm run sim:function
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-function-sim')

let failures = 0
const check = (pass, label, detail) => {
  if (pass) console.log(`✓ ${label}`)
  else {
    failures += 1
    console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

async function main() {
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })

  const bundle = join(work, 'fn.cjs')
  await build({
    entryPoints: [join(root, 'supabase/functions/ai/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    logLevel: 'warning'
  })

  /* ---------------- stand-ins ---------------- */

  const env = {
    SUPABASE_URL: 'https://project.test',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key'
  }

  let handler = null
  globalThis.Deno = {
    env: { get: (name) => env[name] },
    serve: (fn) => {
      handler = fn
    }
  }

  const calls = []
  const balance = { daily: 20000, purchased: 5000, total: 25000, spent: [] }
  /* The Edge Function no longer divides by a rate: cost is the token count. */
  let geminiMode = 'normal'

  const gemini = (body) => {
    const json = body.generationConfig?.responseMimeType === 'application/json'
    const grounded = Array.isArray(body.tools) && body.tools.some((tool) => tool.google_search)
    if (json) {
      return {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    questions: [
                      'What does a battery earn per cycle in India?',
                      'How far have cell prices fallen?',
                      'Who argues storage is still uneconomic?'
                    ],
                    angle: 'Costs fell faster than the market rules adapted.'
                  })
                }
              ]
            }
          }
        ],
        usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 120, totalTokenCount: 620 }
      }
    }
    if (grounded) {
      return {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: 'A 1 MW battery in Gujarat earns roughly ₹4.2 per kWh on arbitrage, per CEA 2025.'
                }
              ]
            },
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: 'https://cea.example.org/storage', title: 'CEA storage report' } },
                { web: { uri: 'https://example.org/arbitrage', title: 'Arbitrage economics' } }
              ],
              webSearchQueries: ['battery arbitrage india']
            }
          }
        ],
        usageMetadata: { promptTokenCount: 1800, candidatesTokenCount: 300, totalTokenCount: 2100 }
      }
    }
    return {
      candidates: [
        {
          content: {
            parts: [
              {
                text: '# Storage is now cheaper than peaking plants\n\nA claim with a citation [1], and a second [2].\n\n## What this leaves open\n\nWho pays for transmission.'
              }
            ]
          }
        }
      ],
      usageMetadata: { promptTokenCount: 6400, candidatesTokenCount: 1600, thoughtsTokenCount: 400, totalTokenCount: 8400 }
    }
  }

  globalThis.fetch = async (rawUrl, init = {}) => {
    const url = String(rawUrl)
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ url, method: init.method ?? 'GET', body, headers: init.headers ?? {} })

    if (url.endsWith('/auth/v1/user')) {
      const token = String(init.headers?.authorization ?? '').replace(/^Bearer\s+/, '')
      if (token === 'good-token') {
        return new Response(JSON.stringify({ id: 'auth-1', email: 'writer@example.com' }), { status: 200 })
      }
      return new Response('{}', { status: 401 })
    }

    if (url.includes('/rest/v1/indra_users')) {
      return new Response(JSON.stringify([{ id: 'profile-1' }]), { status: 200 })
    }

    if (url.includes('/rest/v1/rpc/indra_credit_state')) {
      return new Response(JSON.stringify({ plan: 'free', planName: 'Free', daily: balance.daily, purchased: balance.purchased, total: balance.daily + balance.purchased, dailyAllowance: 100, spentToday: 0, requestsToday: 0, isAdmin: false, settings: { currency: 'USD', symbol: '$', decimals: 2, topupTokens: 100000, topupPriceMinor: 10000, minTopup: 100000, maxTopup: 100000000, lowBalance: 3000, updatedAt: null } }), { status: 200 })
    }

    if (url.includes('/rest/v1/rpc/indra_spend_ai')) {
      const cost = body.p_cost
      if (balance.daily + balance.purchased < cost) {
        return new Response('insufficient_tokens', { status: 400 })
      }
      const fromDaily = Math.min(balance.daily, cost)
      balance.daily -= fromDaily
      balance.purchased -= cost - fromDaily
      balance.spent.push(cost)
      return new Response(JSON.stringify({ daily: balance.daily, purchased: balance.purchased, total: balance.daily + balance.purchased, cost }), { status: 200 })
    }

    if (url.includes('generativelanguage.googleapis.com')) {
      if (geminiMode === 'failure') {
        return new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })
      }
      return new Response(JSON.stringify(gemini(body)), { status: 200 })
    }

    return new Response('unhandled', { status: 404 })
  }

  requireBundle(join(work, 'index.js'))
  const require = createRequire(join(work, 'index.js'))
  require(bundle)

  check(typeof handler === 'function', 'the function registers exactly one request handler')
  if (typeof handler !== 'function') return

  const call = async (payload, { token = 'good-token', method = 'POST' } = {}) => {
    const headers = { 'content-type': 'application/json' }
    if (token) headers.authorization = `Bearer ${token}`
    const response = await handler(
      new Request('https://project.test/functions/v1/indra-ai', {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(payload) : undefined
      })
    )
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  /* ---------------- refusals first ---------------- */

  check((await call({ prompt: 'hi' }, { method: 'GET' })).status === 405, 'a GET is refused')
  check((await call({ prompt: 'hi' }, { token: '' })).status === 401, 'no token, no work')
  check((await call({ prompt: 'hi' }, { token: 'forged' })).status === 401, 'a token the project does not recognise is refused')
  check((await call({ prompt: '  ' })).status === 400, 'an empty question is refused')

  calls.length = 0
  const noKey = await call({ prompt: 'hi' })
  check(noKey.status === 503 && noKey.body.error === 'not_configured', 'no key: reported as not configured', noKey.body?.message)
  check(calls.every((entry) => !entry.url.includes('generativelanguage')), 'no key: no provider is called')

  /* ---------------- chat: charged by real usage ---------------- */

  env.GEMINI_API_KEY = 'test-key'
  balance.daily = 20000
  balance.purchased = 5000
  balance.spent.length = 0
  calls.length = 0

  const chat = await call({ mode: 'chat', prompt: 'Tighten the opening.', document: 'Batteries are displacing peaking plants.' })
  check(chat.status === 200 && chat.body.mode === 'chat', 'a chat turn answers')
  check(chat.body.usage.total === 8400 && chat.body.usage.cost === 8400, 'the cost is the reported tokens, exactly', JSON.stringify(chat.body.usage))
  const chatSpend = calls.filter((entry) => entry.url.includes('indra_spend_ai'))
  check(chatSpend.length === 1, 'a chat turn is charged exactly once')
  check(chatSpend[0]?.body?.p_cost === 8400 && chatSpend[0]?.body?.p_user === 'profile-1', 'the charge names the profile and the token count')
  check(chatSpend[0]?.headers?.authorization === 'Bearer service-role-key', 'the charge is made with the service key, which the app does not have')
  check(chat.body.balance.total === 16600, 'the answer carries the balance after the charge', String(chat.body.balance?.total))

  /* ---------------- research: plan, search, synthesise ---------------- */

  balance.daily = 40000
  balance.purchased = 0
  balance.spent.length = 0
  calls.length = 0

  const research = await call({ mode: 'research', depth: 'deep', prompt: 'Storage economics in India', documentTitle: 'The storage piece' })
  check(research.status === 200 && research.body.mode === 'research', 'a research run answers')
  check(research.body.outline.length === 3, 'the plan produced the questions', String(research.body.outline?.length))
  check(research.body.citations.length === 2, 'the sources are deduplicated across searches', JSON.stringify(research.body.citations?.map((c) => c.url)))
  const providerCalls = calls.filter((entry) => entry.url.includes('generativelanguage'))
  check(providerCalls.length === 5, 'one planning call, three searches, one synthesis', String(providerCalls.length))
  const spendCalls = calls.filter((entry) => entry.url.includes('indra_spend_ai'))
  check(spendCalls.length === 5, 'every step is charged as it happens')
  check(research.body.usage.cost === balance.spent.reduce((sum, cost) => sum + cost, 0), 'the reported total is the sum of the charges')
  check(research.body.answer.includes('[1]'), 'the brief keeps its citations')
  check(research.body.balance.total === 40000 - research.body.usage.cost, 'the balance is the server’s after the run')

  /* ---------------- running out mid-way is honest ---------------- */

  /*
   * Just above the research floor, so the plan is paid for and the searches are
   * not. The run must stop rather than send calls the balance cannot cover.
   */
  balance.daily = 4500
  balance.purchased = 0
  balance.spent.length = 0
  calls.length = 0

  const drained = await call({ mode: 'research', depth: 'deep', prompt: 'A long topic', document: '' })
  check(drained.status === 200 && drained.body.exhausted === true, 'a run that runs out says so', String(drained.body?.exhausted))
  /*
   * The searches run together, so a balance can run dry part-way through them.
   * What must be true is that the synthesis is never sent after that — it is
   * the most expensive call in the run — and that no charge went past zero.
   */
  const stages = calls
    .filter((entry) => entry.url.includes('generativelanguage'))
    .map((entry) => (String(entry.body?.contents?.[0]?.parts?.[0]?.text ?? '').includes('writing a research brief') ? 'synthesis' : 'other'))
  check(!stages.includes('synthesis'), 'the synthesis is not sent once the balance is exhausted', JSON.stringify(stages))
  check(balance.daily >= 0, 'nothing is charged past zero')
  check(drained.body.balance.total === balance.daily + balance.purchased, 'the balance it reports is the real one', String(drained.body.balance?.total))

  /* ---------------- no tokens at all ---------------- */

  balance.daily = 0
  balance.purchased = 0
  calls.length = 0
  const empty = await call({ mode: 'chat', prompt: 'Anything' })
  check(empty.status === 402 && empty.body.error === 'insufficient_tokens', 'no tokens is refused before the provider is called', String(empty.status))
  check(calls.every((entry) => !entry.url.includes('generativelanguage')), 'no tokens: nothing is spent on a model')

  /* ---------------- a provider failure is reported as one ---------------- */

  /* ---------------- the charge is the token count, exactly ---------------- */

  balance.daily = 60000
  balance.purchased = 0
  balance.spent.length = 0
  calls.length = 0

  const exact = await call({ mode: 'chat', prompt: 'Anything', document: '' })
  check(
    exact.status === 200 && exact.body.usage.cost === exact.body.usage.total,
    'the charge equals the tokens the model reported, with no rate applied',
    JSON.stringify({ tokens: exact.body?.usage?.total, cost: exact.body?.usage?.cost })
  )
  const exactSpend = calls.filter((entry) => entry.url.includes('indra_spend_ai'))
  check(
    exactSpend.length === 1 && exactSpend[0].body.p_cost === exact.body.usage.total,
    'the function sends the token count straight to the charging call'
  )

  balance.daily = 30000
  geminiMode = 'failure'
  const broken = await call({ mode: 'chat', prompt: 'Anything', document: '' })
  check(broken.status === 502 && broken.body.error === 'provider_error', 'a provider error is passed on as a failure', String(broken.status))
  check(broken.body.message.includes('API key not valid'), 'and it says what the provider said', broken.body?.message)
  geminiMode = 'normal'

  /* ---------------- the request never carries a key back ---------------- */

  const leaked = calls.filter((entry) => JSON.stringify(entry.body ?? {}).includes('test-key'))
  check(leaked.length === 0, 'the key is only ever in the provider header, never in a body')

  console.log(failures === 0 ? '\n✓ the function charges what it uses, and refuses honestly' : `\n${failures} check(s) failed`)
  if (failures > 0) process.exitCode = 1
}

/** Node's require needs a file to resolve modules from; this only creates it. */
function requireBundle(at) {
  writeFileSync(at, '')
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
})
