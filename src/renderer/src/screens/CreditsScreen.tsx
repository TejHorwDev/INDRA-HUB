import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  AiActivity,
  TokenLedgerEntry,
  TokenPlan,
  TokenSettings,
  TokensState,
  PurchaseRequest
} from '@shared/types'
import EmptyState from '../components/EmptyState'
import Page from '../components/Page'
import { useToast } from '../components/ToastProvider'
import { InfoIcon, SparkIcon } from '../components/icons'
import { api, errorMessage } from '../lib/api'
import { money, shapeFor, tokens } from '../lib/money'

/*
 * Tokens.
 *
 * What this page may and may not know is the point of it. Every number here
 * comes from the server: the balance, the allowance, the price of a tier, what
 * a top-up costs. The app formats those numbers and asks questions; it never
 * decides a price and never changes a balance.
 *
 * The pricing rules arrive with the balance, so a workspace priced in rupees or
 * dollars — or in a currency it invented this morning — draws the same screen
 * without a new build.
 */

const KIND_LABEL: Record<TokenLedgerEntry['kind'], string> = {
  usage: 'Used',
  purchase: 'Top-up',
  grant: 'Granted',
  reset: 'Daily reset',
  adjust: 'Adjusted'
}

/** "just now", "3 hours ago", "yesterday" — a timestamp, not a label. */
function when(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (seconds < 90) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  return date.toLocaleDateString()
}

function resetLabel(state: TokensState): string {
  if (!state.resetAt) return 'no reset scheduled'
  const at = new Date(state.resetAt).getTime()
  const hours = Math.max(0, Math.round((at - Date.now()) / 3_600_000))
  if (hours <= 0) return 'resetting now'
  if (hours < 24) return `resets in ${hours} h`
  return `resets ${when(state.resetAt)}`
}

function describe(entry: TokenLedgerEntry, settings: TokenSettings | null): string {
  const meta = entry.meta ?? {}
  if (entry.kind === 'reset') return `${String(meta.plan ?? 'daily')} allowance`
  if (entry.kind === 'usage') return typeof meta.stage === 'string' ? `AI run · ${meta.stage}` : 'AI run'
  if (entry.kind === 'purchase') {
    if (typeof meta.plan === 'string') return `Plan · ${meta.plan}`
    if (typeof meta.minor === 'number') {
      return `Top-up · ${money(meta.minor, shapeFor(typeof meta.currency === 'string' ? meta.currency : null, settings))}`
    }
    if (typeof meta.inr === 'number') return `Top-up · ${money(meta.inr, shapeFor('INR', settings))}`
    return 'Top-up'
  }
  if (entry.kind === 'grant') return `Granted${typeof meta.reason === 'string' ? ` · ${meta.reason}` : ''}`
  return typeof meta.reason === 'string' ? String(meta.reason) : 'Adjustment'
}

export default function CreditsScreen() {
  const toast = useToast()
  const [state, setState] = useState<TokensState | null>(null)
  const [plans, setPlans] = useState<TokenPlan[]>([])
  const [ledger, setLedger] = useState<TokenLedgerEntry[]>([])
  const [purchases, setPurchases] = useState<PurchaseRequest[]>([])
  const [activity, setActivity] = useState<AiActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busyTier, setBusyTier] = useState<string | null>(null)
  const [topUp, setTopUp] = useState('')
  const [topUpError, setTopUpError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  /*
   * One read, from the server. There is no local copy of a balance to paint
   * first, so while the cloud is answering the screen says nothing rather than
   * something old.
   */
  const load = useCallback(async (mode: 'first' | 'refresh') => {
    if (mode === 'refresh') setRefreshing(true)
    try {
      const live = await api.tokens.state()
      setState(live)
      setLoadError(live.connected ? null : live.message)

      if (live.connected) {
        const [tiers, history, requests, runs] = await Promise.all([
          api.tokens.plans().catch(() => []),
          api.tokens.ledger(40).catch(() => []),
          api.tokens.purchases().catch(() => []),
          api.ai.activity(12).catch(() => [])
        ])
        setPlans(tiers)
        setLedger(history)
        setPurchases(requests)
        setActivity(runs)
      }
    } catch (error) {
      setLoadError(errorMessage(error))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load('first')
  }, [load])

  const pending = useMemo(() => purchases.filter((request) => request.status === 'pending'), [purchases])
  const settings = state?.settings ?? null
  const current = plans.find((plan) => plan.current) ?? null
  const offered = plans.filter((plan) => plan.enabled)
  const usedRatio =
    state && state.dailyAllowance > 0
      ? Math.min(1, Math.max(0, state.spentToday / (state.dailyAllowance + state.spentToday)))
      : 0

  /* The pack is what the server set. A top-up is priced in whole packs, and the
     price of a top-up itself is always the server's answer — never computed
     into a balance here. */
  const pack = settings
    ? {
        tokens: settings.topupTokens,
        price: settings.topupPriceMinor,
      }
    : null

  const topUpAmount = Math.round(Number(topUp.replace(/[^\d]/g, '')))
  const topUpValid =
    Number.isFinite(topUpAmount) &&
    topUpAmount > 0 &&
    (!settings || (topUpAmount >= settings.minTopup && topUpAmount <= settings.maxTopup))
  const topUpPacks =
    settings && pack ? Math.ceil(Math.max(topUpAmount, 0) / Math.max(pack.tokens, 1)) : 0
  const topUpPrice = pack ? topUpPacks * pack.price : 0
  const low = settings !== null && state !== null && state.total <= settings.lowBalance

  useEffect(() => {
    if (!settings || topUp !== '') return
    const suggestion = Math.min(
      Math.max(settings.topupTokens, settings.minTopup),
      settings.maxTopup
    )
    setTopUp(String(suggestion))
  }, [settings, topUp])

  async function requestPlan(plan: TokenPlan) {
    setBusyTier(plan.id)
    try {
      const next = await api.tokens.request({ kind: 'plan', planId: plan.id, note: '' })
      setPurchases(next)
      toast.success(`Asked to move to ${plan.name}. An administrator approves it.`)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusyTier(null)
    }
  }

  async function requestTopUp() {
    setTopUpError(null)
    if (!topUpValid) {
      setTopUpError(
        settings
          ? `Top-ups run from ${tokens(settings.minTopup)} to ${tokens(settings.maxTopup)} tokens.`
          : 'Give a whole number of tokens.'
      )
      return
    }
    setBusyTier('topup')
    try {
      const next = await api.tokens.request({ kind: 'topup', tokens: topUpAmount, note: '' })
      setPurchases(next)
      toast.success(`Asked for ${tokens(topUpAmount)} tokens. An administrator approves it.`)
    } catch (error) {
      setTopUpError(errorMessage(error))
    } finally {
      setBusyTier(null)
    }
  }

  async function withdraw(id: string) {
    try {
      const next = await api.tokens.cancel(id)
      setPurchases(next)
      toast.success('Request withdrawn.')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const offline = state !== null && !state.connected

  return (
    <Page
      title="Tokens"
      description="What AI costs in this workspace, what is left today, and every movement of the balance."
      actions={
        <button
          type="button"
          className="btn btn-ghost btn-sm w-auto"
          onClick={() => void load('refresh')}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      }
    >
      {/* ---------------- the balance ---------------- */}
      <section className="token-balance" aria-label="Balance">
        <div className="token-balance-main">
          <div className="token-balance-figure">
            <p className="token-eyebrow">Available now</p>
            <div className="token-figure">
              <strong>{state ? tokens(state.total) : '—'}</strong>
              <span>tokens</span>
            </div>
            <p className="token-meta">
              {state?.connected ? (
                <>
                  {resetLabel(state)}
                  {state.syncedAt && !state.cached ? ` · read ${when(state.syncedAt)}` : ''}
                  {state.cached && state.syncedAt ? ` · last known ${when(state.syncedAt)}` : ''}
                </>
              ) : (
                'Not connected to a cloud account yet'
              )}
            </p>
          </div>

          <div className="token-balance-side">
            <span className="token-plan">
              <span className="token-plan-dot" aria-hidden="true" />
              {state?.planName ?? 'Free'}
            </span>
            {current?.expiresAt && (
              <span className="token-meta">renews {when(current.expiresAt)}</span>
            )}
          </div>
        </div>

        {state?.connected && (
          <dl className="token-split" aria-label="Balance breakdown">
            <div className="token-split-cell">
              <dt>Daily allowance</dt>
              <dd>
                {tokens(state.daily)} <small>of {tokens(state.dailyAllowance)}</small>
              </dd>
            </div>
            <div className="token-split-cell">
              <dt>Purchased</dt>
              <dd>
                {tokens(state.purchased)} <small>carries over</small>
              </dd>
            </div>
            <div className="token-split-cell">
              <dt>Used today</dt>
              <dd>
                {tokens(state.spentToday)} <small>in {state.requestsToday} runs</small>
              </dd>
            </div>
            <div className="token-meter" aria-hidden="true">
              <span style={{ width: `${Math.round(usedRatio * 100)}%` }} />
            </div>
          </dl>
        )}
      </section>

      {state?.message && (
        <div className="notice mb-4 items-start">
          <InfoIcon />
          <span>{state.message}</span>
        </div>
      )}

      {loadError && !state?.connected && (
        <div className="notice mb-4 items-start">
          <InfoIcon />
          <span>
            {loadError} AI needs an internet connection; nothing is queued and nothing is spent while
            offline.
          </span>
        </div>
      )}

      {low && !state?.cached && (
        <div className="notice mb-4 items-start">
          <InfoIcon />
          <span>
            {state.total === 0
              ? 'Nothing is left in the balance. It refills at the next daily reset, or an administrator can top it up.'
              : `Only ${tokens(state.total)} tokens left — that is below the ${tokens(
                  settings?.lowBalance ?? 0
                )} this workspace warns at.`}
          </span>
        </div>
      )}

      <div className="token-body">
        <div>
          {/* ---------------- plans ---------------- */}
          <section className="token-group" aria-label="Plans">
            <div className="token-group-head">
              <span>Plans</span>
              <span>{current ? `You are on ${current.name}` : 'Free by default'}</span>
            </div>
            <div className="token-group-body">
              {plans.length === 0 ? (
                <p className="token-group-note">
                  {offline
                    ? 'Plans are read from the cloud, so they are not available offline.'
                    : 'Loading the plans from the cloud…'}
                </p>
              ) : offered.length === 0 ? (
                <p className="token-group-note">Every tier is switched off right now. Ask the administrator.</p>
              ) : (
                <div className="plan-list">
                  {offered.map((plan) => (
                    <article
                      key={plan.id}
                      className={`plan-row${plan.current ? ' plan-row--current' : ''}`}
                      aria-current={plan.current ? 'true' : undefined}
                    >
                      <div className="plan-row-name">
                        <span>{plan.name}</span>
                        {plan.current && <span className="plan-row-tag">Current</span>}
                      </div>
                      <p className="plan-row-allowance">
                        <strong>{tokens(plan.dailyTokens)}</strong> tokens a day
                        <span className="plan-row-blurb">{plan.blurb}</span>
                      </p>
                      <p className="plan-row-price">
                        {money(plan.priceMinor, settings)}
                        {plan.priceMinor > 0 && <small>a month</small>}
                      </p>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm w-auto plan-row-action"
                        disabled={
                          plan.current ||
                          busyTier !== null ||
                          offline ||
                          pending.some((request) => request.planId === plan.id)
                        }
                        onClick={() => void requestPlan(plan)}
                      >
                        {plan.current
                          ? 'Your plan'
                          : pending.some((request) => request.planId === plan.id)
                            ? 'Waiting for approval'
                            : busyTier === plan.id
                              ? 'Sending…'
                              : `Request ${plan.name}`}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
            <p className="token-group-note">
              Plans are approved by an administrator — there is no card on file and no automatic
              charge. A request sits here until it is answered, and the allowance changes the moment
              it is.
            </p>
          </section>

          {/* ---------------- top up ---------------- */}
          <section className="token-group" aria-label="Top up">
            <div className="token-group-head">
              <span>Top up</span>
              <span>
                {pack && settings
                  ? `${money(pack.price, settings)} per ${tokens(pack.tokens)} tokens`
                  : 'priced by the server'}
              </span>
            </div>
            <div className="token-group-body">
              {pack && settings ? (
                <>
                  <div className="buy-row">
                    <label className="admin-field buy-field">
                      <span className="field-label">Tokens</span>
                      <input
                        className="field-input"
                        inputMode="numeric"
                        value={topUp}
                        onChange={(event) => {
                          setTopUp(event.target.value.replace(/[^\d]/g, ''))
                          setTopUpError(null)
                        }}
                        aria-label="Tokens to buy"
                      />
                    </label>
                    <div className="buy-quote" aria-live="polite">
                      <span className="buy-quote-label">You would pay</span>
                      <span className="buy-quote-value">
                        {topUpValid ? money(topUpPrice, settings) : '—'}
                      </span>
                      <span className="buy-quote-note">
                        {topUpValid
                          ? `${topUpPacks} ${topUpPacks === 1 ? 'pack' : 'packs'} of ${tokens(
                              pack.tokens
                            )} · ${money(pack.price, settings)} each`
                          : 'Enter an amount to see its price'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary w-auto buy-submit"
                      onClick={() => void requestTopUp()}
                      disabled={busyTier !== null || offline || !topUpValid}
                    >
                      {busyTier === 'topup' ? 'Sending…' : 'Request top-up'}
                    </button>
                  </div>

                  <div className="buy-presets" role="group" aria-label="Common top-ups">
                    {[1, 2, 5, 10].map((multiplier) => {
                      const amount = Math.min(pack.tokens * multiplier, settings.maxTopup)
                      if (amount < settings.minTopup) return null
                      /* Priced the way the server prices it: whole packs. */
                      const packs = Math.ceil(amount / Math.max(pack.tokens, 1))
                      return (
                        <button
                          key={multiplier}
                          type="button"
                          className={`buy-preset${topUpAmount === amount ? ' buy-preset--on' : ''}`}
                          onClick={() => {
                            setTopUp(String(amount))
                            setTopUpError(null)
                          }}
                        >
                          <span>{tokens(amount)} tokens</span>
                          <span className="buy-preset-price">
                            {money(packs * pack.price, settings)}
                          </span>
                        </button>
                      )
                    })}
                  </div>

                  {topUpError && (
                    <p className="token-error" role="alert">
                      {topUpError}
                    </p>
                  )}
                  <p className="token-note">
                    {`Top-ups run from ${tokens(settings.minTopup)} to ${tokens(
                      settings.maxTopup
                    )} tokens, in whole packs.`}{' '}
                    Purchased tokens never expire and are spent after the daily allowance runs out.
                    An administrator approves the request; nothing is charged automatically.
                  </p>
                </>
              ) : (
                <p className="token-group-note">
                  {offline
                    ? 'Prices are read from the cloud, so top-ups are unavailable offline.'
                    : loading
                      ? 'Reading the price of a top-up…'
                      : 'The server did not send its pricing rules, so a top-up cannot be priced. Refresh to try again.'}
                </p>
              )}
            </div>
          </section>
        </div>

        <div>
          {/* ---------------- requests ---------------- */}
          <section className="token-group" aria-label="Requests">
            <div className="token-group-head">
              <span>Requests</span>
              <span>{pending.length > 0 ? `${pending.length} waiting` : 'none waiting'}</span>
            </div>
            {purchases.length === 0 ? (
              <div className="token-group-body">
                <p className="token-group-note">
                  Nothing requested yet. A plan change or a top-up starts here and is answered by an
                  administrator.
                </p>
              </div>
            ) : (
              purchases.slice(0, 8).map((request) => (
                <div className="token-row" key={request.id}>
                  <span className="token-row-kind">{request.kind === 'plan' ? 'Plan' : 'Top-up'}</span>
                  <span className="token-row-what">
                    {request.kind === 'plan'
                      ? (request.planName ?? request.planId ?? 'Plan')
                      : `${tokens(request.tokens ?? 0)} tokens`}
                  </span>
                  <span className="token-row-amount">
                    {request.amountMinor === null
                      ? '—'
                      : money(request.amountMinor, shapeFor(request.currency, settings))}
                  </span>
                  {request.status === 'pending' ? (
                    <button
                      type="button"
                      className="link-quiet token-row-action"
                      onClick={() => void withdraw(request.id)}
                    >
                      Withdraw
                    </button>
                  ) : (
                    <span className="token-row-status token-row-status--decided">
                      {request.status === 'approved' ? 'Approved' : 'Declined'}
                    </span>
                  )}
                </div>
              ))
            )}
          </section>

          {/* ---------------- history ---------------- */}
          <section className="token-group" aria-label="Usage history">
            <div className="token-group-head">
              <span>Balance history</span>
              <span>from the server</span>
            </div>
            {loading ? (
              <div className="token-group-body">
                <p className="token-group-note">Reading the ledger…</p>
              </div>
            ) : ledger.length === 0 ? (
              <EmptyState
                variant="panel"
                icon={<SparkIcon size={16} />}
                title="Nothing spent yet"
                description="Every reset, charge and top-up is written here by the database itself."
              />
            ) : (
              ledger.slice(0, 14).map((entry) => (
                <div className="token-row" key={entry.id}>
                  <span className="token-row-kind">{KIND_LABEL[entry.kind]}</span>
                  <span className="token-row-what">{describe(entry, settings)}</span>
                  <span className={`token-row-amount${entry.amount < 0 ? ' token-row-amount--down' : ''}`}>
                    {entry.amount > 0 ? '+' : ''}
                    {tokens(entry.amount)}
                  </span>
                  <span className="token-row-when">{when(entry.createdAt)}</span>
                </div>
              ))
            )}
          </section>
        </div>
      </div>

      <section className="token-group token-group--spaced" aria-label="Recent AI work">
        <div className="token-group-head">
          <span>Recent research on this PC</span>
          <span>{activity.length > 0 ? `${activity.length} runs` : 'nothing yet'}</span>
        </div>
        {activity.length === 0 ? (
          <div className="token-group-body">
            <p className="token-group-note">
              Open a document and use <strong>Research</strong> to plan a topic, read sources and
              write the brief into the page. What it cost appears here and in the ledger above.
            </p>
          </div>
        ) : (
          activity.map((run) => (
            <div className="token-row" key={run.id}>
              <span className="token-row-kind">{run.mode === 'research' ? 'Research' : 'Writing'}</span>
              <span className="token-row-what">
                {run.prompt} · {run.documentTitle}
              </span>
              <span className="token-row-amount token-row-amount--down">−{tokens(run.tokens)}</span>
              <span className="token-row-when">{when(run.createdAt)}</span>
            </div>
          ))
        )}
      </section>

      <p className="token-note mt-4">
        These numbers are the server's, read when the page opens. Nothing is stored on this PC, and
        nothing here authorises a request: the database writes the charge itself, from the tokens the
        model actually reported.{' '}
        {settings && (
          <>
            Prices are set by an administrator, in {settings.currency},{' '}
            {money(settings.topupPriceMinor, settings)} for {tokens(settings.topupTokens)} tokens.{' '}
          </>
        )}
        <Link to="/settings" className="link-quiet">
          Cloud settings
        </Link>
      </p>
    </Page>
  )
}
