import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  AiActivity,
  CreditLedgerEntry,
  CreditPlan,
  CreditSettings,
  CreditsState,
  PurchaseRequest
} from '@shared/types'
import EmptyState from '../components/EmptyState'
import Page from '../components/Page'
import { useToast } from '../components/ToastProvider'
import { InfoIcon, SparkIcon } from '../components/icons'
import { api, errorMessage } from '../lib/api'
import { credits, money, shapeFor } from '../lib/money'

/*
 * Credits.
 *
 * What this page may and may not know is the point of it. Every number here
 * comes from the server: the balance, the allowance, the price of a tier, what
 * a top-up costs, what a credit buys. The app formats those numbers and asks
 * questions; it never decides a price and never changes a balance.
 *
 * The pricing rules arrive with the balance, so a workspace priced in rupees or
 * dollars — or in a currency it invented this morning — draws the same screen
 * without a new build.
 */

const KIND_LABEL: Record<CreditLedgerEntry['kind'], string> = {
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

function resetLabel(state: CreditsState): string {
  if (!state.resetAt) return 'no reset scheduled'
  const at = new Date(state.resetAt).getTime()
  const hours = Math.max(0, Math.round((at - Date.now()) / 3_600_000))
  if (hours <= 0) return 'resetting now'
  if (hours < 24) return `resets in ${hours} h`
  return `resets ${when(state.resetAt)}`
}

function describe(entry: CreditLedgerEntry, settings: CreditSettings | null): string {
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
  const [state, setState] = useState<CreditsState | null>(null)
  const [plans, setPlans] = useState<CreditPlan[]>([])
  const [ledger, setLedger] = useState<CreditLedgerEntry[]>([])
  const [purchases, setPurchases] = useState<PurchaseRequest[]>([])
  const [activity, setActivity] = useState<AiActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busyTier, setBusyTier] = useState<string | null>(null)
  const [topUp, setTopUp] = useState('')
  const [topUpError, setTopUpError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  /*
   * Two reads, on purpose: the cached copy paints immediately, the live one
   * replaces it when the cloud answers. The cached number is never shown as
   * if it were current — it carries the line above it.
   */
  const load = useCallback(async (mode: 'first' | 'refresh') => {
    if (mode === 'refresh') setRefreshing(true)
    try {
      const cached = await api.credits.state(true)
      setState((current) => current ?? cached)

      const live = await api.credits.state(false)
      setState(live)
      setLoadError(live.connected ? null : live.message)

      if (live.connected) {
        const [tiers, history, requests, runs] = await Promise.all([
          api.credits.plans().catch(() => []),
          api.credits.ledger(40).catch(() => []),
          api.credits.purchases().catch(() => []),
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

  /* What one credit costs is derived from the pack the server set, for display
     only — the price of a top-up itself is always the server's answer. */
  const pack = settings
    ? {
        credits: settings.topupCredits,
        price: settings.topupPriceMinor,
        perCredit:
          settings.topupCredits > 0 ? settings.topupPriceMinor / settings.topupCredits : 0
      }
    : null

  const topUpAmount = Math.round(Number(topUp.replace(/[^\d]/g, '')))
  const topUpValid =
    Number.isFinite(topUpAmount) &&
    topUpAmount > 0 &&
    (!settings || (topUpAmount >= settings.minTopup && topUpAmount <= settings.maxTopup))
  const topUpPacks =
    settings && pack ? Math.ceil(Math.max(topUpAmount, 0) / Math.max(pack.credits, 1)) : 0
  const topUpPrice = pack ? topUpPacks * pack.price : 0
  const low = settings !== null && state !== null && state.total <= settings.lowBalance

  useEffect(() => {
    if (!settings || topUp !== '') return
    const suggestion = Math.min(
      Math.max(settings.topupCredits, settings.minTopup),
      settings.maxTopup
    )
    setTopUp(String(suggestion))
  }, [settings, topUp])

  async function requestPlan(plan: CreditPlan) {
    setBusyTier(plan.id)
    try {
      const next = await api.credits.request({ kind: 'plan', planId: plan.id, note: '' })
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
          ? `Top-ups run from ${credits(settings.minTopup)} to ${credits(settings.maxTopup)} credits.`
          : 'Give a whole number of credits.'
      )
      return
    }
    setBusyTier('topup')
    try {
      const next = await api.credits.request({ kind: 'credits', credits: topUpAmount, note: '' })
      setPurchases(next)
      toast.success(`Asked for ${credits(topUpAmount)} credits. An administrator approves it.`)
    } catch (error) {
      setTopUpError(errorMessage(error))
    } finally {
      setBusyTier(null)
    }
  }

  async function withdraw(id: string) {
    try {
      const next = await api.credits.cancel(id)
      setPurchases(next)
      toast.success('Request withdrawn.')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const offline = state !== null && !state.connected

  return (
    <Page
      title="Credits"
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
      <section className="credit-hero" aria-label="Balance">
        <div className="credit-hero-main">
          <div className="credit-hero-figure">
            <p className="credits-eyebrow">Available now</p>
            <div className="credits-figure">
              <strong>{state ? credits(state.total) : '—'}</strong>
              <span>credits</span>
            </div>
            <p className="credits-meta">
              {state?.connected ? (
                <>
                  {resetLabel(state)}
                  {settings ? ` · 1 credit is ${credits(settings.tokensPerCredit)} tokens` : ''}
                  {state.syncedAt && !state.cached ? ` · read ${when(state.syncedAt)}` : ''}
                  {state.cached && state.syncedAt ? ` · last known ${when(state.syncedAt)}` : ''}
                </>
              ) : (
                'Not connected to a cloud account yet'
              )}
            </p>
          </div>

          <div className="credit-hero-side">
            <span className="credits-plan">
              <span className="credits-plan-dot" aria-hidden="true" />
              {state?.planName ?? 'Free'}
            </span>
            {current?.expiresAt && (
              <span className="credits-meta">renews {when(current.expiresAt)}</span>
            )}
          </div>
        </div>

        {state?.connected && (
          <dl className="credits-split" aria-label="Balance breakdown">
            <div className="credits-cell">
              <dt>Daily allowance</dt>
              <dd>
                {credits(state.daily)} <small>of {credits(state.dailyAllowance)}</small>
              </dd>
            </div>
            <div className="credits-cell">
              <dt>Purchased</dt>
              <dd>
                {credits(state.purchased)} <small>carries over</small>
              </dd>
            </div>
            <div className="credits-cell">
              <dt>Used today</dt>
              <dd>
                {credits(state.spentToday)} <small>in {state.requestsToday} runs</small>
              </dd>
            </div>
            <div className="credits-bar" aria-hidden="true">
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
              : `Only ${credits(state.total)} credits left — that is below the ${credits(
                  settings?.lowBalance ?? 0
                )} this workspace warns at.`}
          </span>
        </div>
      )}

      <div className="credits-body">
        <div>
          {/* ---------------- plans ---------------- */}
          <section className="credits-panel" aria-label="Plans">
            <div className="credits-panel-head">
              <span>Plans</span>
              <span>{current ? `You are on ${current.name}` : 'Free by default'}</span>
            </div>
            <div className="credits-panel-body">
              {plans.length === 0 ? (
                <p className="ai-empty">
                  {offline
                    ? 'Plans are read from the cloud, so they are not available offline.'
                    : 'Loading the plans from the cloud…'}
                </p>
              ) : offered.length === 0 ? (
                <p className="ai-empty">Every tier is switched off right now. Ask the administrator.</p>
              ) : (
                <div className="tier-row">
                  {offered.map((plan) => (
                    <article
                      key={plan.id}
                      className={`tier${plan.current ? ' tier--current' : ''}`}
                      aria-current={plan.current ? 'true' : undefined}
                    >
                      <div className="tier-top">
                        <span className="tier-name">{plan.name}</span>
                        <span className={`tier-tag${plan.current ? ' tier-tag--current' : ''}`}>
                          {plan.current ? 'Current' : 'Available'}
                        </span>
                      </div>
                      <p className="tier-price">
                        {money(plan.priceMinor, settings)}
                        {plan.priceMinor > 0 && <small>per month</small>}
                      </p>
                      <p className="tier-allowance">
                        {credits(plan.dailyCredits)} credits every day
                      </p>
                      <p className="tier-blurb">{plan.blurb}</p>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm w-auto"
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
            <p className="credits-note">
              Plans are approved by an administrator — there is no card on file and no automatic
              charge. A request sits here until it is answered, and the allowance changes the moment
              it is.
            </p>
          </section>

          {/* ---------------- top up ---------------- */}
          <section className="credits-panel" aria-label="Top up">
            <div className="credits-panel-head">
              <span>Top up</span>
              <span>
                {pack && settings
                  ? `${money(pack.price, settings)} per ${credits(pack.credits)} credits`
                  : 'priced by the server'}
              </span>
            </div>
            <div className="credits-panel-body">
              {pack && settings ? (
                <>
                  <div className="buy-row">
                    <label className="admin-field buy-field">
                      <span className="field-label">Credits</span>
                      <input
                        className="field-input"
                        inputMode="numeric"
                        value={topUp}
                        onChange={(event) => {
                          setTopUp(event.target.value.replace(/[^\d]/g, ''))
                          setTopUpError(null)
                        }}
                        aria-label="Credits to buy"
                      />
                    </label>
                    <div className="buy-quote" aria-live="polite">
                      <span className="buy-quote-label">You would pay</span>
                      <span className="buy-quote-value">
                        {topUpValid ? money(topUpPrice, settings) : '—'}
                      </span>
                      <span className="buy-quote-note">
                        {topUpValid
                          ? `${topUpPacks} ${topUpPacks === 1 ? 'pack' : 'packs'} of ${credits(
                              pack.credits
                            )} · ${money(pack.price, settings)} each`
                          : 'Enter an amount to see its price'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm w-auto"
                      onClick={() => void requestTopUp()}
                      disabled={busyTier !== null || offline || !topUpValid}
                    >
                      {busyTier === 'topup' ? 'Sending…' : 'Request top-up'}
                    </button>
                  </div>

                  <div className="buy-presets" role="group" aria-label="Common top-ups">
                    {[1, 2, 5, 10].map((multiplier) => {
                      const amount = Math.min(pack.credits * multiplier, settings.maxTopup)
                      if (amount < settings.minTopup) return null
                      /* Priced the way the server prices it: whole packs. */
                      const packs = Math.ceil(amount / Math.max(pack.credits, 1))
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
                          <span>{credits(amount)} credits</span>
                          <span className="buy-preset-price">
                            {money(packs * pack.price, settings)}
                          </span>
                        </button>
                      )
                    })}
                  </div>

                  {topUpError && <p className="member-hint">{topUpError}</p>}
                  <p className="member-hint mt-3">
                    {`Top-ups run from ${credits(settings.minTopup)} to ${credits(
                      settings.maxTopup
                    )} credits, in whole packs.`}{' '}
                    Purchased credits never expire and are spent after the daily allowance runs out.
                    An administrator approves the request; nothing is charged automatically.
                  </p>
                </>
              ) : (
                <p className="ai-empty">
                  {offline
                    ? 'Prices are read from the cloud, so top-ups are unavailable offline.'
                    : 'Loading the price of a top-up…'}
                </p>
              )}
            </div>
          </section>
        </div>

        <div>
          {/* ---------------- requests ---------------- */}
          <section className="credits-panel" aria-label="Requests">
            <div className="credits-panel-head">
              <span>Requests</span>
              <span>{pending.length > 0 ? `${pending.length} waiting` : 'none waiting'}</span>
            </div>
            {purchases.length === 0 ? (
              <div className="credits-panel-body">
                <p className="ai-empty">
                  Nothing requested yet. A plan change or a top-up starts here and is answered by an
                  administrator.
                </p>
              </div>
            ) : (
              purchases.slice(0, 8).map((request) => (
                <div className="credit-row" key={request.id}>
                  <span className="credit-kind">{request.kind === 'plan' ? 'Plan' : 'Top-up'}</span>
                  <span className="credit-what">
                    {request.kind === 'plan'
                      ? request.planName ?? request.planId ?? 'Plan'
                      : `${credits(request.credits ?? 0)} credits`}
                    {request.amountMinor !== null
                      ? ` · ${money(request.amountMinor, shapeFor(request.currency, settings))}`
                      : ''}
                  </span>
                  {request.status === 'pending' ? (
                    <button
                      type="button"
                      className="link-quiet text-[0.6875rem]"
                      onClick={() => void withdraw(request.id)}
                    >
                      Withdraw
                    </button>
                  ) : (
                    <span className="credit-when">
                      {request.status === 'approved' ? 'approved' : 'declined'}
                    </span>
                  )}
                </div>
              ))
            )}
          </section>

          {/* ---------------- history ---------------- */}
          <section className="credits-panel" aria-label="Usage history">
            <div className="credits-panel-head">
              <span>Balance history</span>
              <span>from the server</span>
            </div>
            {loading ? (
              <div className="credits-panel-body">
                <p className="ai-empty">Reading the ledger…</p>
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
                <div className="credit-row" key={entry.id}>
                  <span className="credit-kind">{KIND_LABEL[entry.kind]}</span>
                  <span className="credit-what">{describe(entry, settings)}</span>
                  <span className={`credit-amount${entry.amount < 0 ? ' credit-amount--down' : ''}`}>
                    {entry.amount > 0 ? '+' : ''}
                    {credits(entry.amount)}
                  </span>
                  <span className="credit-when">{when(entry.createdAt)}</span>
                </div>
              ))
            )}
          </section>
        </div>
      </div>

      <section className="credits-panel mt-4" aria-label="Recent AI work">
        <div className="credits-panel-head">
          <span>Recent research on this PC</span>
          <span>{activity.length > 0 ? `${activity.length} runs` : 'nothing yet'}</span>
        </div>
        {activity.length === 0 ? (
          <div className="credits-panel-body">
            <p className="ai-empty">
              Open a document and use <strong>Research</strong> to plan a topic, read sources and
              write the brief into the page. What it cost appears here and in the ledger above.
            </p>
          </div>
        ) : (
          activity.map((run) => (
            <div className="credit-row" key={run.id}>
              <span className="credit-kind">{run.mode === 'research' ? 'Research' : 'Writing'}</span>
              <span className="credit-what">
                {run.prompt} · {run.documentTitle}
              </span>
              <span className="credit-amount credit-amount--down">−{credits(run.credits)}</span>
              <span className="credit-when">{when(run.createdAt)}</span>
            </div>
          ))
        )}
      </section>

      <p className="member-hint mt-4 max-w-[760px]">
        The balance in this app is a copy of the server's. It is refreshed whenever this page opens
        and never authorises a request on its own — the charged amount is written by the database
        after the model reports its tokens.{' '}
        {settings && (
          <>
            Prices are set by an administrator, in {settings.currency},{' '}
            {money(settings.topupPriceMinor, settings)} for {credits(settings.topupCredits)} credits.{' '}
          </>
        )}
        <Link to="/settings" className="link-quiet">
          Cloud settings
        </Link>
      </p>
    </Page>
  )
}
