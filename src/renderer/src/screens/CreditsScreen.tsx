import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  AiActivity,
  CreditLedgerEntry,
  CreditPlan,
  CreditsState,
  PurchaseRequest
} from '@shared/types'
import EmptyState from '../components/EmptyState'
import Page from '../components/Page'
import { useToast } from '../components/ToastProvider'
import { InfoIcon, SparkIcon } from '../components/icons'
import { api, errorMessage } from '../lib/api'
import { formatRelative } from '../lib/format'

const KIND_LABEL: Record<CreditLedgerEntry['kind'], string> = {
  usage: 'Used',
  purchase: 'Top-up',
  grant: 'Granted',
  reset: 'Daily reset',
  adjust: 'Adjusted'
}

const money = (value: number): string => `₹${value.toLocaleString('en-IN')}`

/** Credits are whole numbers; the server never sends fractions. */
const credits = (value: number): string => Math.round(value).toLocaleString('en-IN')

function resetLabel(state: CreditsState): string {
  if (!state.resetAt) return 'no reset scheduled'
  const at = new Date(state.resetAt).getTime()
  const hours = Math.max(0, Math.round((at - Date.now()) / 3_600_000))
  if (hours <= 0) return 'resetting now'
  if (hours < 24) return `resets in ${hours} h`
  return `resets ${formatRelative(state.resetAt)}`
}

function describe(entry: CreditLedgerEntry): string {
  const meta = entry.meta ?? {}
  if (entry.kind === 'reset') return `${String(meta.plan ?? 'daily')} allowance`
  if (entry.kind === 'usage') return typeof meta.stage === 'string' ? `AI run · ${meta.stage}` : 'AI run'
  if (entry.kind === 'purchase') {
    if (typeof meta.plan === 'string') return `Plan · ${meta.plan}`
    if (typeof meta.inr === 'number') return `Top-up · ${money(meta.inr)}`
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
  const [topUp, setTopUp] = useState('500')
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
  const current = plans.find((plan) => plan.current) ?? null
  const usedRatio =
    state && state.dailyAllowance > 0
      ? Math.min(1, Math.max(0, state.spentToday / (state.dailyAllowance + state.spentToday)))
      : 0

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
    const amount = Math.round(Number(topUp))
    if (!Number.isFinite(amount) || amount < 100 || amount > 100_000) {
      setTopUpError('Top-ups run from 100 to 100,000 credits.')
      return
    }
    setBusyTier('topup')
    try {
      const next = await api.credits.request({ kind: 'credits', credits: amount, note: '' })
      setPurchases(next)
      toast.success(`Asked for ${credits(amount)} credits. An administrator approves it.`)
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
      <section className="credits-head" aria-label="Balance">
        <div>
          <p className="credits-eyebrow">Available now</p>
          <div className="credits-figure">
            <strong>{state ? credits(state.total) : '—'}</strong>
            <span>credits</span>
          </div>
          <p className="credits-meta">
            {state?.connected ? (
              <>
                {resetLabel(state)} · 1 credit is 1,000 tokens
                {state.syncedAt && !state.cached ? ` · read ${formatRelative(state.syncedAt)}` : ''}
                {state.cached && state.syncedAt ? ` · last known ${formatRelative(state.syncedAt)}` : ''}
              </>
            ) : (
              'Not connected to a cloud account yet'
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="credits-plan">
            <span className="credits-plan-dot" aria-hidden="true" />
            {state?.planName ?? 'Free'}
          </span>
          {current?.expiresAt && (
            <span className="credits-meta">until {formatRelative(current.expiresAt)}</span>
          )}
        </div>
      </section>

      {state?.message && (
        <div className="notice mb-4 max-w-[640px] items-start">
          <InfoIcon />
          <span>{state.message}</span>
        </div>
      )}

      {loadError && !state?.connected && (
        <div className="notice mb-4 max-w-[640px] items-start">
          <InfoIcon />
          <span>
            {loadError} AI needs an internet connection; nothing is queued and nothing is spent while
            offline.
          </span>
        </div>
      )}

      {state?.connected && (
        <dl className="credits-split mb-4" aria-label="Balance breakdown">
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
          <div className="credits-bar" aria-hidden="true" style={{ gridColumn: '1 / -1' }}>
            <span style={{ width: `${Math.round(usedRatio * 100)}%` }} />
          </div>
        </dl>
      )}

      <div className="credits-body">
        <div>
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
              ) : (
                <div className="tier-row">
                  {plans.map((plan) => (
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
                        {plan.priceInr === 0 ? 'Free' : money(plan.priceInr)}
                        {plan.priceInr > 0 && <small>per month</small>}
                      </p>
                      <p className="tier-allowance">
                        {credits(plan.dailyCredits)} credits every day
                      </p>
                      <p className="tier-blurb">{plan.blurb}</p>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm w-auto"
                        disabled={plan.current || busyTier !== null || offline || pending.some((request) => request.planId === plan.id)}
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

          <section className="credits-panel" aria-label="Top up">
            <div className="credits-panel-head">
              <span>Top up</span>
              <span>₹99 per 100 credits</span>
            </div>
            <div className="credits-panel-body">
              <div className="flex flex-wrap items-end gap-3">
                <label className="admin-field w-[180px]">
                  <span className="field-label">Credits</span>
                  <input
                    className="field-input"
                    inputMode="numeric"
                    value={topUp}
                    onChange={(event) => setTopUp(event.target.value.replace(/[^\d]/g, ''))}
                    aria-label="Credits to buy"
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary btn-sm w-auto"
                  onClick={() => void requestTopUp()}
                  disabled={busyTier !== null || offline}
                >
                  {busyTier === 'topup' ? 'Sending…' : 'Request top-up'}
                </button>
              </div>
              {topUpError && <p className="member-hint">{topUpError}</p>}
              <p className="member-hint mt-3">
                Purchased credits never expire and are spent after the daily allowance runs out.
              </p>
            </div>
          </section>
        </div>

        <div>
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
                  <span className="credit-kind">
                    {request.kind === 'plan' ? 'Plan' : 'Top-up'}
                  </span>
                  <span className="credit-what">
                    {request.kind === 'plan'
                      ? request.planName ?? request.planId ?? 'Plan'
                      : `${credits(request.credits ?? 0)} credits`}
                    {request.amountInr !== null ? ` · ${money(request.amountInr)}` : ''}
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
                  <span className="credit-what">{describe(entry)}</span>
                  <span
                    className={`credit-amount${entry.amount < 0 ? ' credit-amount--down' : ''}`}
                  >
                    {entry.amount > 0 ? '+' : ''}
                    {credits(entry.amount)}
                  </span>
                  <span className="credit-when">{formatRelative(entry.createdAt)}</span>
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
              <span className="credit-when">{formatRelative(run.createdAt)}</span>
            </div>
          ))
        )}
      </section>

      <p className="member-hint mt-4 max-w-[720px]">
        The balance in this app is a copy of the server's. It is refreshed whenever this page opens
        and never authorises a request on its own — the charged amount is written by the database
        after the model reports its tokens.{' '}
        <Link to="/settings" className="link-quiet">
          Cloud settings
        </Link>
      </p>
    </Page>
  )
}
