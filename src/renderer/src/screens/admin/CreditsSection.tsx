import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AdminTokenAccountDetail,
  AdminTokenLedgerRow,
  AdminTokenSnapshot,
  AdminSpendRow,
  TokenPlan,
  AiReadiness,
  TokenSettings
} from '@shared/types'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useToast } from '../../components/ToastProvider'
import { PlusIcon } from '../../components/icons'
import { api, errorMessage } from '../../lib/api'
import { minorFrom, minorToText, money, tokens } from '../../lib/money'
import { Badge, SectionHead, SearchField, formatDate, formatDateTime } from './shared'
import type { SectionProps } from './shared'

/*
 * Tokens, from the administrator's side.
 *
 * Two gates stand in front of every button here: the administrator session on
 * this machine, and the server's own check that the signed-in cloud account
 * holds the administrator role. When the second one is missing, this section
 * says so and stays read-only — it never pretends a change was made.
 *
 * Prices are money, so they are edited as money: the currency, its symbol and
 * its decimals are settings; a tier's price and the top-up pack are entered in
 * that currency and sent to the server as whole minor units. Nothing here is
 * hardcoded, so what a top-up costs can change without a new build.
 */

const CURRENCIES: Array<{ code: string; name: string; symbol: string; decimals: number }> = [
  { code: 'USD', name: 'US dollar', symbol: '$', decimals: 2 },
  { code: 'NPR', name: 'Nepalese rupee', symbol: 'Rs', decimals: 2 },
  { code: 'INR', name: 'Indian rupee', symbol: '₹', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  { code: 'GBP', name: 'Pound sterling', symbol: '£', decimals: 2 },
  { code: 'AUD', name: 'Australian dollar', symbol: 'A$', decimals: 2 },
  { code: 'CAD', name: 'Canadian dollar', symbol: 'C$', decimals: 2 },
  { code: 'AED', name: 'UAE dirham', symbol: 'AED', decimals: 2 },
  { code: 'SGD', name: 'Singapore dollar', symbol: 'S$', decimals: 2 },
  { code: 'BDT', name: 'Bangladeshi taka', symbol: '৳', decimals: 2 },
  { code: 'PKR', name: 'Pakistani rupee', symbol: 'Rs', decimals: 2 },
  { code: 'LKR', name: 'Sri Lankan rupee', symbol: 'Rs', decimals: 2 },
  { code: 'JPY', name: 'Japanese yen', symbol: '¥', decimals: 0 }
]

interface PlanDraft {
  name: string
  blurb: string
  daily: string
  price: string
}

/*
 * `enabled` is deliberately not part of the draft. Switching a tier on or off
 * is its own action with its own confirmation; if it rode along with the text
 * fields, saving a reworded blurb could silently switch a retired tier back on.
 */
function draftOf(plan: TokenPlan, settings: TokenSettings | null): PlanDraft {
  return {
    name: plan.name,
    blurb: plan.blurb,
    daily: String(plan.dailyTokens),
    price: minorToText(plan.priceMinor, settings?.decimals ?? 2)
  }
}

export default function CreditsSection(_props: SectionProps) {
  const toast = useToast()
  const [snapshot, setSnapshot] = useState<AdminTokenSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [openAccount, setOpenAccount] = useState<string | null>(null)
  const [ledger, setLedger] = useState<AdminTokenLedgerRow[]>([])
  const [ledgerFor, setLedgerFor] = useState<string | null>(null)
  const [grantAmount, setGrantAmount] = useState('')
  const [grantReason, setGrantReason] = useState('')
  const [planDraft, setPlanDraft] = useState<Record<string, PlanDraft>>({})
  /** Whether the workspace holds a model key. Without one, no run can start. */
  const [readiness, setReadiness] = useState<AiReadiness | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<{
    currency: string
    symbol: string
    decimals: string
    topupTokens: string
    topupPrice: string
    minTopup: string
    maxTopup: string
    lowBalance: string
  } | null>(null)
  const [newPlan, setNewPlan] = useState<{ open: boolean; id: string; name: string; daily: string; price: string }>(
    { open: false, id: '', name: '', daily: '', price: '' }
  )
  const [confirmOff, setConfirmOff] = useState<TokenPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminTokenAccountDetail | null>(null)
  const [detailFor, setDetailFor] = useState<string | null>(null)
  const [spend, setSpend] = useState<AdminSpendRow[]>([])
  const [spendOpen, setSpendOpen] = useState(false)
  const [confirmSuspend, setConfirmSuspend] = useState<{ id: string; name: string; suspended: boolean } | null>(
    null
  )

  const settings = snapshot?.settings ?? null

  /*
   * A balance console is the right place to say whether the engine behind those
   * balances can run at all: every figure here looked fine while nothing did.
   */
  useEffect(() => {
    let live = true
    api.ai
      .readiness()
      .then((next) => {
        if (live) setReadiness(next)
      })
      .catch(() => {
        /* The snapshot's own reachability line already covers this. */
      })
    return () => {
      live = false
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const next = await api.admin.tokens()
      setSnapshot(next)
      setPlanDraft((current) => {
        const draft: Record<string, PlanDraft> = {}
        for (const plan of next.plans) {
          draft[plan.id] = current[plan.id] ?? draftOf(plan, next.settings)
        }
        return draft
      })
      if (next.settings) {
        setSettingsDraft((current) =>
          current ?? {
            currency: next.settings!.currency,
            symbol: next.settings!.symbol,
            decimals: String(next.settings!.decimals),
            topupTokens: String(next.settings!.topupTokens),
            topupPrice: minorToText(next.settings!.topupPriceMinor, next.settings!.decimals),
            minTopup: String(next.settings!.minTopup),
            maxTopup: String(next.settings!.maxTopup),
            lowBalance: String(next.settings!.lowBalance)
          }
        )
      }
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const accounts = useMemo(() => {
    if (!snapshot) return []
    const needle = query.trim().toLowerCase()
    if (!needle) return snapshot.accounts
    return snapshot.accounts.filter((account) =>
      `${account.displayName} ${account.username} ${account.email ?? ''}`.toLowerCase().includes(needle)
    )
  }, [snapshot, query])

  async function act(key: string, run: () => Promise<AdminTokenSnapshot>, success: string) {
    setBusy(key)
    setError(null)
    try {
      setSnapshot(await run())
      toast.success(success)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  async function decide(id: string, approve: boolean) {
    await act(
      `decide:${id}`,
      () => api.admin.decidePurchase(id, approve, approve ? 'Approved in the token console.' : 'Declined.'),
      approve ? 'Request approved — the balance is updated.' : 'Request declined.'
    )
  }

  async function setPlan(userId: string, planId: string) {
    await act(`plan:${userId}`, () => api.admin.setPlan(userId, planId, 30), 'Plan changed for 30 days.')
  }

  async function grant(userId: string) {
    const amount = Math.round(Number(grantAmount))
    if (!Number.isFinite(amount) || amount === 0) {
      setError('Give an amount of tokens, positive or negative.')
      return
    }
    await act(
      `grant:${userId}`,
      () => api.admin.grantTokens(userId, amount, grantReason),
      `${tokens(amount)} tokens applied.`
    )
    setGrantAmount('')
    setGrantReason('')
  }

  /** Saves every field of one tier, including whether it is still offered. */
  async function savePlan(plan: TokenPlan) {
    const draft = planDraft[plan.id]
    if (!draft) return
    const decimals = settings?.decimals ?? 2
    const priceMinor = draft.price.trim() === '' ? 0 : minorFrom(draft.price, decimals)
    if (priceMinor === null) {
      setError(`A price has at most ${decimals} decimal places.`)
      return
    }
    const daily = Number(draft.daily)
    if (!Number.isFinite(daily) || daily < 0) {
      setError('A daily allowance is a whole number of tokens, zero or more.')
      return
    }
    setBusy(`planEdit:${plan.id}`)
    setError(null)
    try {
      await api.admin.updatePlan({
        id: plan.id,
        name: draft.name,
        blurb: draft.blurb,
        dailyTokens: Math.round(daily),
        priceMinor
      })
      const next = await api.admin.tokens()
      setSnapshot(next)
      setPlanDraft((current) => {
        const nextDraft: Record<string, PlanDraft> = {}
        for (const tier of next.plans) {
          nextDraft[tier.id] = tier.id === plan.id ? draftOf(tier, next.settings) : current[tier.id] ?? draftOf(tier, next.settings)
        }
        return nextDraft
      })
      toast.success(`${draft.name} saved: ${tokens(daily)} tokens a day.`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  async function createPlan() {
    const id = newPlan.id.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]{1,30}$/.test(id)) {
      setError('A tier id is 2–31 lowercase letters, digits, dashes or underscores.')
      return
    }
    if (!newPlan.name.trim()) {
      setError('Give the new tier a name.')
      return
    }
    const priceMinor = newPlan.price.trim() === '' ? 0 : minorFrom(newPlan.price, settings?.decimals ?? 2)
    if (priceMinor === null) {
      setError('That price cannot be read.')
      return
    }
    setBusy('createPlan')
    setError(null)
    try {
      await api.admin.updatePlan({
        id,
        name: newPlan.name.trim(),
        dailyTokens: Math.max(0, Math.round(Number(newPlan.daily) || 0)),
        priceMinor,
        create: true
      })
      setNewPlan({ open: false, id: '', name: '', daily: '', price: '' })
      await load()
      toast.success(`Tier ${newPlan.name.trim()} created.`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  async function toggleEnabled(plan: TokenPlan, enabled: boolean) {
    if (!enabled) {
      setConfirmOff(plan)
      return
    }
    await savePlanFlag(plan, true)
  }

  async function savePlanFlag(plan: TokenPlan, enabled: boolean) {
    setBusy(`toggle:${plan.id}`)
    setError(null)
    try {
      await api.admin.updatePlan({ id: plan.id, enabled })
      await load()
      toast.success(enabled ? `${plan.name} is offered again.` : `${plan.name} is switched off.`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
      setConfirmOff(null)
    }
  }

  async function saveSettings() {
    if (!settingsDraft) return
    const decimals = Math.min(Math.max(Math.round(Number(settingsDraft.decimals) || 0), 0), 3)
    const topupPriceMinor = minorFrom(settingsDraft.topupPrice, decimals)
    if (topupPriceMinor === null) {
      setError(`The pack price has at most ${decimals} decimal places.`)
      return
    }
    const numeric = (value: string): number | null => {
      const parsed = Math.round(Number(value))
      return Number.isFinite(parsed) ? parsed : null
    }
    const payload = {
      currency: settingsDraft.currency.trim().toUpperCase(),
      symbol: settingsDraft.symbol.trim(),
      decimals,
      topupTokens: numeric(settingsDraft.topupTokens),
      topupPriceMinor,
      minTopup: numeric(settingsDraft.minTopup),
      maxTopup: numeric(settingsDraft.maxTopup),
      lowBalance: numeric(settingsDraft.lowBalance)
    }
    if (Object.values(payload).some((value) => value === null || value === '')) {
      setError('Every field in the pricing form needs a value.')
      return
    }
    setBusy('settings')
    setError(null)
    try {
      const saved = await api.admin.updateTokenSettings({
        currency: payload.currency,
        symbol: payload.symbol,
        decimals: payload.decimals,
        topupTokens: payload.topupTokens ?? undefined,
        topupPriceMinor: payload.topupPriceMinor ?? undefined,
        minTopup: payload.minTopup ?? undefined,
        maxTopup: payload.maxTopup ?? undefined,
        lowBalance: payload.lowBalance ?? undefined
      })
      setSnapshot((current) => (current ? { ...current, settings: saved } : current))
      setSettingsDraft({
        currency: saved.currency,
        symbol: saved.symbol,
        decimals: String(saved.decimals),
        topupTokens: String(saved.topupTokens),
        topupPrice: minorToText(saved.topupPriceMinor, saved.decimals),
        minTopup: String(saved.minTopup),
        maxTopup: String(saved.maxTopup),
        lowBalance: String(saved.lowBalance)
      })
      toast.success('Pricing saved. Every screen reads it from the server.')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  function applyCurrency(code: string) {
    const known = CURRENCIES.find((entry) => entry.code === code)
    setSettingsDraft((current) =>
      current
        ? {
            ...current,
            currency: code,
            symbol: known?.symbol ?? current.symbol,
            decimals: String(known?.decimals ?? current.decimals)
          }
        : current
    )
  }

  /**
   * Taking the role is the one action that makes this console usable on a
   * project that has never had a credit administrator. It asks the server, and
   * the answer is whatever the server says — a refusal is shown, not swallowed.
   */
  async function claimRole() {
    setBusy('claim')
    setError(null)
    try {
      const next = await api.admin.claimTokenAdmin()
      setSnapshot(next)
      if (next.live) toast.success('This installation now administers tokens.')
      else setError(next.message ?? 'The server did not grant the role.')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  async function toggleSuspended(userId: string, suspended: boolean) {
    setBusy(`suspend:${userId}`)
    setError(null)
    try {
      setSnapshot(await api.admin.setSuspended(userId, suspended))
      toast.success(suspended ? 'Account suspended.' : 'Account restored.')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
      setConfirmSuspend(null)
    }
  }

  async function resetDaily() {
    setBusy('reset')
    setError(null)
    try {
      const result = await api.admin.resetDaily()
      setSnapshot(result.snapshot)
      toast.success(
        result.refilled === 0
          ? 'Every balance was already refilled today.'
          : `Refilled ${result.refilled} ${result.refilled === 1 ? 'account' : 'accounts'}.`
      )
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  async function openDetail(userId: string) {
    if (detailFor === userId) {
      setDetailFor(null)
      setDetail(null)
      return
    }
    setDetailFor(userId)
    setDetail(null)
    setBusy(`detail:${userId}`)
    try {
      setDetail(await api.admin.tokenAccount(userId))
    } catch (caught) {
      setError(errorMessage(caught))
      setDetailFor(null)
    } finally {
      setBusy(null)
    }
  }

  async function toggleSpend() {
    if (spendOpen) {
      setSpendOpen(false)
      return
    }
    setSpendOpen(true)
    setBusy('spend')
    try {
      setSpend(await api.admin.tokenSpend(60))
    } catch (caught) {
      setError(errorMessage(caught))
      setSpend([])
    } finally {
      setBusy(null)
    }
  }

  async function openLedger(userId: string) {
    if (ledgerFor === userId) {
      setLedgerFor(null)
      return
    }
    setLedgerFor(userId)
    setBusy(`ledger:${userId}`)
    try {
      setLedger(await api.admin.tokenLedger(userId, 40))
    } catch (caught) {
      setError(errorMessage(caught))
      setLedger([])
    } finally {
      setBusy(null)
    }
  }

  const pending = snapshot?.pending ?? []
  const decided = snapshot?.decided ?? []
  const symbol = settings?.symbol || '$'
  const decimals = settings?.decimals ?? 2

  return (
    <>
      <SectionHead
        title="Tokens"
        description="The daily allowance each tier grants, what a top-up costs, and every movement of every balance. The server enforces all of it; this console only asks."
      >
        <span className="admin-credits-live">
          <span
            className={`admin-chip-dot${snapshot?.live ? '' : ' admin-chip--muted'}`}
            aria-hidden="true"
          />
          {snapshot?.live
            ? 'Managing tokens'
            : snapshot?.reachable
              ? 'Role not held'
              : 'Server unreachable'}
        </span>
        <button type="button" className="btn btn-ghost btn-sm w-auto" onClick={() => void load()} disabled={loading}>
          {loading ? 'Reading…' : 'Refresh'}
        </button>
      </SectionHead>

      {error && (
        <div className="notice mb-4 items-start">
          <span>{error}</span>
        </div>
      )}

      {readiness && (
        <div className={`admin-ai-state${readiness.configured ? '' : ' admin-ai-state--off'}`}>
          <span
            className={`admin-chip-dot${readiness.configured ? '' : ' admin-chip--muted'}`}
            aria-hidden="true"
          />
          <div>
            <p className="admin-ai-state-title">
              {readiness.configured
                ? `The model key is in place, from ${readiness.keySource ?? 'the project environment'}`
                : 'No model key — AI refuses every run before it charges'}
            </p>
            <p className="admin-ai-state-note">
              {readiness.configured
                ? `Writing runs on ${readiness.models.chat ?? 'the configured model'}; deep research plans its questions, reads the web in two passes, then writes the brief with its sources.`
                : 'The function is deployed and the balances are live, but there is no provider key, so nothing can be answered or charged. Add GEMINI_API_KEY under Supabase → Edge Functions → Secrets, then press Refresh.'}
            </p>
          </div>
        </div>
      )}

      {/*
       * Three different questions, and the panel used to answer all of them
       * with "sign in to continue": is the server reachable, has it granted this
       * installation the role, and if not, what is the one thing that fixes it.
       * Each is answered on its own now, with the action that resolves it.
       */}
      {snapshot && !snapshot.live && (
        <section className="admin-group">
          <div className="admin-group-head">
            <h2>{snapshot.reachable ? 'Token administration is not granted yet' : 'The server did not answer'}</h2>
          </div>
          <div className="admin-group-body">
            <p className="admin-group-note admin-group-note--lead">
              {snapshot.message ??
                'The server has not granted token administration to this installation.'}
            </p>
            {/*
             * Which cloud account this PC is. Without it, "the role is not
             * granted" is the same sentence whether another machine holds it,
             * the role is free, or this is a brand-new identity after a
             * reinstall — and only one of those is fixed by pressing the button.
             */}
            {snapshot.identity?.email && (
              <dl className="admin-kv admin-kv--inline">
                <div>
                  <dt>This PC&rsquo;s cloud account</dt>
                  <dd className="admin-key-placeholder">{snapshot.identity.email}</dd>
                </div>
              </dl>
            )}
            {/*
             * With no server there is no cached copy to show: an unreachable
             * cloud returns no snapshot at all, so promising one "below" was a
             * promise this page could not keep. Say what is true instead.
             */}
            {!snapshot.reachable && (
              <p className="admin-group-note">
                Nothing can be read or changed until it does. Every figure this section shows comes from the server,
                never from a local copy, so there is no stale balance here to mistake for a real one.
              </p>
            )}
            <div className="admin-form-actions">
              {snapshot.reachable ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm w-auto"
                  onClick={() => void claimRole()}
                  disabled={busy !== null}
                >
                  {busy === 'claim' ? <span className="spinner" aria-hidden="true" /> : null}
                  Make this account the administrator
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm w-auto"
                  onClick={() => void load()}
                  disabled={loading}
                >
                  Try again
                </button>
              )}
            </div>
            <p className="admin-group-note">
              The role belongs to the server, not to this PC. The button never takes it from an administrator who is
              still using the console: if one is, the server refuses and says so. An installation that has been
              abandoned for a day stops counting as in use, so a reinstalled PC can pick the role back up without
              anybody editing the database.
            </p>
          </div>
        </section>
      )}

      {snapshot?.live && (
        <>
          {/*
           * One sentence of state, not a row of tiles. What an administrator
           * needs at a glance is: who is waiting on me, and when does everyone
           * refill. Everything else is below, where it is acted on.
           */}
          <p className="admin-lede">
            <strong>{pending.length === 0 ? 'Nothing is waiting' : `${pending.length} waiting`}</strong>
            {pending.length === 1 ? ' request' : ' requests'} ·{' '}
            {snapshot.reset?.totalAccounts ?? snapshot.accounts.length}{' '}
            {(snapshot.reset?.totalAccounts ?? snapshot.accounts.length) === 1 ? 'account' : 'accounts'}
            {snapshot.reset?.suspendedAccounts ? `, ${snapshot.reset.suspendedAccounts} suspended` : ''} ·{' '}
            {snapshot.plans.filter((plan) => plan.enabled).length} of {snapshot.plans.length} tiers offered
            {snapshot.reset?.nextResetAt
              ? ` · daily tokens refill ${formatDateTime(snapshot.reset.nextResetAt)}`
              : ''}
          </p>

          {/*
           * The two fleet-wide actions. Both are idempotent and both say what
           * they did, so neither can be pressed twice by accident and leave the
           * administrator wondering whether it worked.
           */}
          <div className="admin-credit-tools">
            <button
              type="button"
              className="btn btn-ghost btn-sm w-auto"
              onClick={() => void resetDaily()}
              disabled={busy !== null}
              title="Refills every account's daily allowance now. Accounts already refilled today are untouched."
            >
              {busy === 'reset' ? <span className="spinner" aria-hidden="true" /> : null}
              Refill everyone's daily tokens
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm w-auto"
              onClick={() => void toggleSpend()}
              disabled={busy !== null}
            >
              {spendOpen ? 'Hide every movement' : 'Every movement, all accounts'}
            </button>
          </div>

          {spendOpen && (
            <section className="admin-group">
              <div className="admin-group-head">
                <h2>All movements</h2>
                <span className="admin-group-count">{spend.length}</span>
              </div>
              {spend.length === 0 ? (
                <p className="admin-group-note">
                  {busy === 'spend' ? 'Reading…' : 'No token movement has been recorded yet.'}
                </p>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th scope="col">Account</th>
                        <th scope="col">Kind</th>
                        <th scope="col" className="admin-num">
                          Amount
                        </th>
                        <th scope="col" className="admin-num">
                          Balance after
                        </th>
                        <th scope="col">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {spend.map((row) => (
                        <tr key={row.id}>
                          <td>{row.accountName}</td>
                          <td className="admin-dim">{row.kind}</td>
                          <td className="admin-num">
                            {row.amount > 0 ? '+' : ''}
                            {tokens(row.amount)}
                          </td>
                          <td className="admin-num">{tokens(row.balanceAfter)}</td>
                          <td className="admin-dim">{formatDateTime(row.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ---------------- pricing rules ---------------- */}
          <section className="admin-group">
            <div className="admin-group-head">
              <h2>Pricing</h2>
              <span className="admin-group-count">
                {settings ? `saved ${formatDateTime(settings.updatedAt)}` : 'not read yet'}
              </span>
            </div>
            {settingsDraft ? (
              <div className="admin-group-body">
                <div className="admin-form-grid">
                  <label className="admin-field">
                    <span className="field-label">Currency</span>
                    <input
                      className="field-input"
                      value={settingsDraft.currency}
                      maxLength={3}
                      spellCheck={false}
                      onChange={(event) =>
                        setSettingsDraft((current) =>
                          current
                            ? { ...current, currency: event.target.value.replace(/[^A-Za-z]/g, '').toUpperCase() }
                            : current
                        )
                      }
                      aria-label="Currency code"
                    />
                  </label>
                  <label className="admin-field">
                    <span className="field-label">Symbol</span>
                    <input
                      className="field-input"
                      value={settingsDraft.symbol}
                      maxLength={6}
                      onChange={(event) =>
                        setSettingsDraft((current) => (current ? { ...current, symbol: event.target.value } : current))
                      }
                      aria-label="Currency symbol"
                    />
                  </label>
                  <label className="admin-field">
                    <span className="field-label">Decimals</span>
                    <input
                      className="field-input"
                      inputMode="numeric"
                      value={settingsDraft.decimals}
                      onChange={(event) =>
                        setSettingsDraft((current) =>
                          current ? { ...current, decimals: event.target.value.replace(/[^\d]/g, '').slice(0, 1) } : current
                        )
                      }
                      aria-label="Decimal places"
                    />
                  </label>
                </div>

                <div className="admin-preset-row" role="group" aria-label="Common currencies">
                  {CURRENCIES.slice(0, 6).map((entry) => (
                    <button
                      key={entry.code}
                      type="button"
                      className={`buy-preset${
                        settingsDraft.currency === entry.code ? ' buy-preset--on' : ''
                      }`}
                      onClick={() => applyCurrency(entry.code)}
                      title={`${entry.name} · ${entry.symbol}`}
                    >
                      <span>{entry.code}</span>
                      <span className="buy-preset-price">{entry.symbol}</span>
                    </button>
                  ))}
                  <label className="buy-preset buy-preset--select">
                    <span className="sr-only">Other currencies</span>
                    <select
                      value={CURRENCIES.some((entry) => entry.code === settingsDraft.currency) ? settingsDraft.currency : ''}
                      onChange={(event) => {
                        if (event.target.value) applyCurrency(event.target.value)
                      }}
                      aria-label="Other currencies"
                    >
                      <option value="">Other…</option>
                      {CURRENCIES.map((entry) => (
                        <option key={entry.code} value={entry.code}>
                          {entry.code} · {entry.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="admin-form-grid admin-form-grid--wide">
                  <label className="admin-field">
                    <span className="field-label">Pack size (tokens)</span>
                    <input
                      className="field-input"
                      inputMode="numeric"
                      value={settingsDraft.topupTokens}
                      onChange={(event) =>
                        setSettingsDraft((current) =>
                          current ? { ...current, topupTokens: event.target.value.replace(/[^\d]/g, '') } : current
                        )
                      }
                      aria-label="Tokens per pack"
                    />
                  </label>
                  <label className="admin-field">
                    <span className="field-label">Pack price ({symbol})</span>
                    <input
                      className="field-input"
                      inputMode="decimal"
                      value={settingsDraft.topupPrice}
                      onChange={(event) =>
                        setSettingsDraft((current) => (current ? { ...current, topupPrice: event.target.value } : current))
                      }
                      aria-label="Price of one pack"
                    />
                    <span className="admin-field-hint">
                      {minorFrom(settingsDraft.topupPrice, decimals) !== null && Number(settingsDraft.topupTokens) > 0
                        ? `= ${money(minorFrom(settingsDraft.topupPrice, decimals) ?? 0, settings)} per pack · ${money(
                            Math.round(
                              (minorFrom(settingsDraft.topupPrice, decimals) ?? 0) / Math.max(Number(settingsDraft.topupTokens), 1)
                            ),
                            settings
                          )} per token`
                        : 'One pack costs this much.'}
                    </span>
                  </label>
                  <label className="admin-field">
                    <span className="field-label">Smallest top-up</span>
                    <input
                      className="field-input"
                      inputMode="numeric"
                      value={settingsDraft.minTopup}
                      onChange={(event) =>
                        setSettingsDraft((current) =>
                          current ? { ...current, minTopup: event.target.value.replace(/[^\d]/g, '') } : current
                        )
                      }
                      aria-label="Smallest top-up"
                    />
                  </label>
                  <label className="admin-field">
                    <span className="field-label">Largest top-up</span>
                    <input
                      className="field-input"
                      inputMode="numeric"
                      value={settingsDraft.maxTopup}
                      onChange={(event) =>
                        setSettingsDraft((current) =>
                          current ? { ...current, maxTopup: event.target.value.replace(/[^\d]/g, '') } : current
                        )
                      }
                      aria-label="Largest top-up"
                    />
                  </label>
                  <label className="admin-field">
                    <span className="field-label">Low-balance warning</span>
                    <input
                      className="field-input"
                      inputMode="numeric"
                      value={settingsDraft.lowBalance}
                      onChange={(event) =>
                        setSettingsDraft((current) =>
                          current ? { ...current, lowBalance: event.target.value.replace(/[^\d]/g, '') } : current
                        )
                      }
                      aria-label="Low balance warning at"
                    />
                    <span className="admin-field-hint">The balance at which the app suggests a top-up.</span>
                  </label>
                </div>

                <div className="admin-form-actions admin-form-actions--start">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm w-auto"
                    onClick={() => void saveSettings()}
                    disabled={busy !== null}
                  >
                    {busy === 'settings' ? 'Saving…' : 'Save pricing'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm w-auto"
                    disabled={busy !== null || !settings}
                    onClick={() =>
                      settings &&
                      setSettingsDraft({
                        currency: settings.currency,
                        symbol: settings.symbol,
                        decimals: String(settings.decimals),
                        topupTokens: String(settings.topupTokens),
                        topupPrice: minorToText(settings.topupPriceMinor, settings.decimals),
                        minTopup: String(settings.minTopup),
                        maxTopup: String(settings.maxTopup),
                        lowBalance: String(settings.lowBalance)
                      })
                    }
                  >
                    Reset
                  </button>
                </div>
                <p className="admin-group-note">
                  Prices are stored in whole minor units of {settings?.currency ?? 'the workspace currency'} — a
                  price of {money(199, settings)} is stored as 199. Changing the currency changes how prices are
                  read, not what they are worth in another country, so re-enter them after a change.
                </p>
              </div>
            ) : (
              <p className="admin-group-note">Reading the pricing rules…</p>
            )}
          </section>

          {/* ---------------- tiers ---------------- */}
          <section className="admin-group">
            <div className="admin-group-head">
              <h2>Tiers</h2>
              <div className="admin-row-actions">
                <span className="admin-group-count">{snapshot.plans.length}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm w-auto"
                  onClick={() =>
                    setNewPlan((current) => ({
                      ...current,
                      open: !current.open
                    }))
                  }
                >
                  <PlusIcon size={13} />
                  {newPlan.open ? 'Close' : 'New tier'}
                </button>
              </div>
            </div>

            {newPlan.open && (
              <div className="admin-form-grid admin-form-grid--wide admin-plan-new">
                <label className="admin-field">
                  <span className="field-label">Id</span>
                  <input
                    className="field-input"
                    value={newPlan.id}
                    placeholder="team"
                    spellCheck={false}
                    onChange={(event) =>
                      setNewPlan((current) => ({
                        ...current,
                        id: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '')
                      }))
                    }
                  />
                </label>
                <label className="admin-field">
                  <span className="field-label">Name</span>
                  <input
                    className="field-input"
                    value={newPlan.name}
                    placeholder="Team"
                    onChange={(event) => setNewPlan((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label className="admin-field">
                  <span className="field-label">Tokens a day</span>
                  <input
                    className="field-input"
                    inputMode="numeric"
                    value={newPlan.daily}
                    placeholder="5000"
                    onChange={(event) =>
                      setNewPlan((current) => ({ ...current, daily: event.target.value.replace(/[^\d]/g, '') }))
                    }
                  />
                </label>
                <label className="admin-field">
                  <span className="field-label">Price ({symbol})</span>
                  <input
                    className="field-input"
                    inputMode="decimal"
                    value={newPlan.price}
                    placeholder="19.99"
                    onChange={(event) => setNewPlan((current) => ({ ...current, price: event.target.value }))}
                  />
                </label>
                <div className="admin-form-actions admin-form-actions--start">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm w-auto"
                    onClick={() => void createPlan()}
                    disabled={busy !== null}
                  >
                    {busy === 'createPlan' ? 'Creating…' : 'Create tier'}
                  </button>
                </div>
              </div>
            )}

            {snapshot.plans.map((plan) => {
              const draft = planDraft[plan.id] ?? draftOf(plan, settings)
              const on = plan.enabled
              return (
                <div className={`admin-plan-row${on ? '' : ' admin-plan-row--off'}`} key={plan.id}>
                  <div className="admin-plan-id">
                    <span className="admin-credit-name">{plan.id}</span>
                    {!on && <Badge tone="neutral">Off</Badge>}
                  </div>

                  <label className="admin-field">
                    <span className="field-label">Name</span>
                    <input
                      className="field-input"
                      value={draft.name}
                      aria-label={`${plan.id} name`}
                      onChange={(event) =>
                        setPlanDraft((current) => ({ ...current, [plan.id]: { ...draft, name: event.target.value } }))
                      }
                    />
                  </label>

                  <label className="admin-field">
                    <span className="field-label">Tokens a day</span>
                    <input
                      className="field-input"
                      inputMode="numeric"
                      value={draft.daily}
                      aria-label={`${plan.id} daily tokens`}
                      onChange={(event) =>
                        setPlanDraft((current) => ({
                          ...current,
                          [plan.id]: { ...draft, daily: event.target.value.replace(/[^\d]/g, '') }
                        }))
                      }
                    />
                  </label>

                  <label className="admin-field">
                    <span className="field-label">Price / month ({symbol})</span>
                    <input
                      className="field-input"
                      inputMode="decimal"
                      value={draft.price}
                      aria-label={`${plan.id} price`}
                      onChange={(event) =>
                        setPlanDraft((current) => ({ ...current, [plan.id]: { ...draft, price: event.target.value } }))
                      }
                    />
                  </label>

                  <label className="admin-field admin-plan-blurb">
                    <span className="field-label">Blurb</span>
                    <input
                      className="field-input"
                      value={draft.blurb}
                      aria-label={`${plan.id} blurb`}
                      onChange={(event) =>
                        setPlanDraft((current) => ({ ...current, [plan.id]: { ...draft, blurb: event.target.value } }))
                      }
                    />
                  </label>

                  <div className="admin-row-actions admin-plan-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm w-auto"
                      disabled={busy !== null}
                      onClick={() => void savePlan(plan)}
                    >
                      {busy === `planEdit:${plan.id}` ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm w-auto"
                      disabled={busy !== null}
                      onClick={() => void toggleEnabled(plan, !on)}
                    >
                      {on ? 'Switch off' : 'Switch on'}
                    </button>
                  </div>
                </div>
              )
            })}
            <p className="admin-group-note">
              A tier that accounts are on cannot be switched off — move those accounts first. A change to an
              allowance applies from each account's next daily reset; existing balances are not rewritten.
            </p>
          </section>

          {/* ---------------- waiting ---------------- */}
          <section className="admin-group">
            <div className="admin-group-head">
              <h2>Waiting for an answer</h2>
              <span className="admin-group-count">{pending.length}</span>
            </div>
            {pending.length === 0 ? (
              <p className="admin-group-note">Nothing is waiting. Requests appear here the moment they are made.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Account</th>
                      <th scope="col">Asked for</th>
                      <th scope="col" className="admin-num">
                        Amount
                      </th>
                      <th scope="col">When</th>
                      <th scope="col">Answer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((request) => (
                      <tr key={request.id}>
                        <td>
                          <span className="admin-strong">{request.accountName}</span>
                          <span className="admin-handle">{request.accountEmail ?? request.accountId}</span>
                        </td>
                        <td className="admin-dim">
                          {request.kind === 'plan'
                            ? `Plan · ${request.planName ?? request.planId}`
                            : `Top-up · ${tokens(request.tokens ?? 0)} tokens`}
                          {request.note ? <span className="admin-inline-note"> · {request.note}</span> : null}
                        </td>
                        <td className="admin-num">
                          {money(request.amountMinor, settings)}
                          {request.currency && request.currency !== settings?.currency ? (
                            <span className="admin-handle"> {request.currency}</span>
                          ) : null}
                        </td>
                        <td className="admin-dim">{formatDateTime(request.createdAt)}</td>
                        <td>
                          <div className="admin-row-actions">
                            <button
                              type="button"
                              className="btn btn-primary btn-sm w-auto"
                              disabled={busy !== null}
                              onClick={() => void decide(request.id, true)}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm w-auto"
                              disabled={busy !== null}
                              onClick={() => void decide(request.id, false)}
                            >
                              Decline
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ---------------- accounts ---------------- */}
          <section className="admin-group">
            <div className="admin-group-head">
              <h2>Accounts</h2>
              {/*
               * A filtered list says it is filtered. The count beside the search
               * is the *shown* count, so it can never disagree with the rows
               * underneath it — the fleet total lives in the summary above.
               */}
              {query.trim() !== '' && (
                <span className="admin-dim">
                  {accounts.length} of {snapshot.accounts.length} shown
                </span>
              )}
              <SearchField value={query} onChange={setQuery} placeholder="Search accounts" />
            </div>
            {accounts.length === 0 ? (
              <p className="admin-group-note">
                {query.trim() === ''
                  ? 'No accounts exist yet. The first person to sign up appears here.'
                  : `No account matches “${query.trim()}”.`}
              </p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Account</th>
                      <th scope="col">Plan</th>
                      <th scope="col" className="admin-num">
                        Daily
                      </th>
                      <th scope="col" className="admin-num">
                        Bought
                      </th>
                      <th scope="col" className="admin-num">
                        Total
                      </th>
                      <th scope="col">Last seen</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((account) => (
                      <tr key={account.id}>
                        <td>
                          <span className="admin-strong">{account.displayName}</span>
                          <span className="admin-handle">@{account.username}</span>
                          {account.suspended && <Badge tone="warn">Suspended</Badge>}
                        </td>
                        <td>
                          <select
                            className="field-input"
                            value={account.plan}
                            aria-label={`Plan for ${account.displayName}`}
                            disabled={busy !== null}
                            onChange={(event) => void setPlan(account.id, event.target.value)}
                          >
                            {snapshot.plans.map((plan) => (
                              <option key={plan.id} value={plan.id}>
                                {plan.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="admin-num">{tokens(account.daily)}</td>
                        <td className="admin-num">{tokens(account.purchased)}</td>
                        <td className="admin-num">{tokens(account.total)}</td>
                        <td className="admin-dim">{formatDate(account.lastSignInAt)}</td>
                        <td>
                          <div className="admin-row-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm w-auto"
                              onClick={() => setOpenAccount(openAccount === account.id ? null : account.id)}
                            >
                              {openAccount === account.id ? 'Close' : 'Adjust'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm w-auto"
                              disabled={busy !== null}
                              onClick={() => void openLedger(account.id)}
                            >
                              {ledgerFor === account.id ? 'Hide log' : 'Log'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm w-auto"
                              disabled={busy !== null}
                              onClick={() => void openDetail(account.id)}
                            >
                              {detailFor === account.id ? 'Close' : 'Open'}
                            </button>
                            {/*
                             * Suspension is a switch with a consequence, so it
                             * asks first and says which account it is about.
                             */}
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm w-auto"
                              disabled={busy !== null}
                              onClick={() =>
                                setConfirmSuspend({
                                  id: account.id,
                                  name: account.displayName || `@${account.username}`,
                                  suspended: !account.suspended
                                })
                              }
                            >
                              {account.suspended ? 'Restore' : 'Suspend'}
                            </button>
                          </div>

                          {detailFor === account.id && (
                            <div className="admin-account-detail">
                              {detail ? (
                                <>
                                  <dl className="admin-kv admin-kv--inline">
                                    <div>
                                      <dt>Member</dt>
                                      <dd>{detail.account.memberNo ?? '—'}</dd>
                                    </div>
                                    <div>
                                      <dt>Created</dt>
                                      <dd>{formatDate(detail.account.createdAt)}</dd>
                                    </div>
                                    <div>
                                      <dt>Plan ends</dt>
                                      <dd>{formatDate(detail.account.planExpiresAt)}</dd>
                                    </div>
                                    <div>
                                      <dt>AI runs</dt>
                                      <dd>{tokens(detail.account.requests)}</dd>
                                    </div>
                                    <div>
                                      <dt>Next daily refill</dt>
                                      <dd>
                                        {detail.account.tokensResetAt
                                          ? formatDateTime(detail.account.tokensResetAt)
                                          : 'On the next refill'}
                                      </dd>
                                    </div>
                                  </dl>
                                  {detail.ledger.length === 0 ? (
                                    <p className="admin-group-note">This account has no movements yet.</p>
                                  ) : (
                                    <ul className="admin-account-history">
                                      {detail.ledger.slice(0, 12).map((entry) => (
                                        <li key={entry.id}>
                                          <span className="admin-dim">{formatDateTime(entry.createdAt)}</span>
                                          <span>{entry.kind}</span>
                                          <span className="admin-num">
                                            {entry.amount > 0 ? '+' : ''}
                                            {tokens(entry.amount)}
                                          </span>
                                          <span className="admin-num admin-dim">
                                            → {tokens(entry.balanceAfter)}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </>
                              ) : (
                                <p className="admin-group-note">Reading…</p>
                              )}
                            </div>
                          )}

                          {openAccount === account.id && (
                            <div className="mt-2 flex flex-wrap items-end gap-2">
                              <label className="admin-field w-[110px]">
                                <span className="field-label">Tokens</span>
                                <input
                                  className="field-input"
                                  inputMode="numeric"
                                  value={grantAmount}
                                  placeholder="500"
                                  onChange={(event) => setGrantAmount(event.target.value.replace(/[^\d-]/g, ''))}
                                />
                              </label>
                              <label className="admin-field w-[190px]">
                                <span className="field-label">Reason</span>
                                <input
                                  className="field-input"
                                  value={grantReason}
                                  placeholder="Support token"
                                  onChange={(event) => setGrantReason(event.target.value)}
                                />
                              </label>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm w-auto"
                                disabled={busy !== null}
                                onClick={() => void grant(account.id)}
                              >
                                Apply
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {ledgerFor && (
            <section className="admin-group">
              <div className="admin-group-head">
                <h2>Ledger</h2>
                <span className="admin-group-count">{ledger.length}</span>
              </div>
              {ledger.length === 0 ? (
                <p className="admin-group-note">No movements yet for this account.</p>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th scope="col">Kind</th>
                        <th scope="col" className="admin-num">
                          Amount
                        </th>
                        <th scope="col" className="admin-num">
                          Balance after
                        </th>
                        <th scope="col">Detail</th>
                        <th scope="col">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.map((row) => (
                        <tr key={row.id}>
                          <td className="admin-dim">{row.kind}</td>
                          <td className="admin-num">
                            {row.amount > 0 ? '+' : ''}
                            {tokens(row.amount)}
                          </td>
                          <td className="admin-num">{tokens(row.balanceAfter)}</td>
                          <td className="admin-dim">{JSON.stringify(row.meta)}</td>
                          <td className="admin-dim">{formatDateTime(row.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <section className="admin-group">
            <div className="admin-group-head">
              <h2>Answered</h2>
              <span className="admin-group-count">{decided.length}</span>
            </div>
            {decided.length === 0 ? (
              <p className="admin-group-note">No request has been answered yet.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Account</th>
                      <th scope="col">Asked for</th>
                      <th scope="col">Status</th>
                      <th scope="col">Answered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decided.map((request) => (
                      <tr key={request.id}>
                        <td className="admin-strong">{request.accountName}</td>
                        <td className="admin-dim">
                          {request.kind === 'plan'
                            ? `Plan · ${request.planName ?? request.planId}`
                            : `Top-up · ${tokens(request.tokens ?? 0)} tokens`}
                        </td>
                        <td>
                          {request.status === 'approved' ? (
                            <Badge tone="good">Approved</Badge>
                          ) : (
                            <Badge tone="neutral">Declined</Badge>
                          )}
                        </td>
                        <td className="admin-dim">{formatDateTime(request.decidedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {confirmOff && (
        <ConfirmDialog
          open
          title={`Switch off ${confirmOff.name}?`}
          confirmLabel="Switch off"
          pending={busy === `toggle:${confirmOff.id}`}
          onCancel={() => setConfirmOff(null)}
          onConfirm={() => void savePlanFlag(confirmOff, false)}
        >
          The tier disappears from the Tokens page. Accounts already on it keep it until they are
          moved, and the server refuses the change while any account is on it.
        </ConfirmDialog>
      )}

      {confirmSuspend && (
        <ConfirmDialog
          open
          title={confirmSuspend.suspended ? `Suspend ${confirmSuspend.name}?` : `Restore ${confirmSuspend.name}?`}
          confirmLabel={confirmSuspend.suspended ? 'Suspend' : 'Restore'}
          pending={busy === `suspend:${confirmSuspend.id}`}
          onCancel={() => setConfirmSuspend(null)}
          onConfirm={() => void toggleSuspended(confirmSuspend.id, confirmSuspend.suspended)}
        >
          {confirmSuspend.suspended
            ? 'The server refuses their top-up requests and AI runs while suspended. Their balance is kept exactly as it is, and restoring the account returns it untouched.'
            : 'The account can request a top-up and use AI again. Nothing about its balance changes.'}
        </ConfirmDialog>
      )}
    </>
  )
}
