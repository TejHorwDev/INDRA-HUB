import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AdminCreditLedgerRow,
  AdminCreditSnapshot,
  CreditPlan,
  CreditSettings
} from '@shared/types'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useToast } from '../../components/ToastProvider'
import { PlusIcon } from '../../components/icons'
import { api, errorMessage } from '../../lib/api'
import { credits, minorFrom, minorToText, money } from '../../lib/money'
import { Badge, SectionHead, SearchField, formatDate, formatDateTime } from './shared'
import type { SectionProps } from './shared'

/*
 * Credits, from the administrator's side.
 *
 * Two gates stand in front of every button here: the administrator session on
 * this machine, and the server's own check that the signed-in cloud account
 * holds the administrator role. When the second one is missing, this section
 * says so and stays read-only — it never pretends a change was made.
 *
 * Prices are money, so they are edited as money: the currency, its symbol and
 * its decimals are settings; a tier's price and the top-up pack are entered in
 * that currency and sent to the server as whole minor units. Nothing here is
 * hardcoded, so what a credit costs can change without a new build.
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
function draftOf(plan: CreditPlan, settings: CreditSettings | null): PlanDraft {
  return {
    name: plan.name,
    blurb: plan.blurb,
    daily: String(plan.dailyCredits),
    price: minorToText(plan.priceMinor, settings?.decimals ?? 2)
  }
}

export default function CreditsSection({ overview }: SectionProps) {
  const toast = useToast()
  const [snapshot, setSnapshot] = useState<AdminCreditSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [openAccount, setOpenAccount] = useState<string | null>(null)
  const [ledger, setLedger] = useState<AdminCreditLedgerRow[]>([])
  const [ledgerFor, setLedgerFor] = useState<string | null>(null)
  const [grantAmount, setGrantAmount] = useState('')
  const [grantReason, setGrantReason] = useState('')
  const [planDraft, setPlanDraft] = useState<Record<string, PlanDraft>>({})
  const [settingsDraft, setSettingsDraft] = useState<{
    currency: string
    symbol: string
    decimals: string
    tokensPerCredit: string
    topupCredits: string
    topupPrice: string
    minTopup: string
    maxTopup: string
    lowBalance: string
  } | null>(null)
  const [newPlan, setNewPlan] = useState<{ open: boolean; id: string; name: string; daily: string; price: string }>(
    { open: false, id: '', name: '', daily: '', price: '' }
  )
  const [confirmOff, setConfirmOff] = useState<CreditPlan | null>(null)
  const [error, setError] = useState<string | null>(null)

  const settings = snapshot?.settings ?? null

  const load = useCallback(async () => {
    try {
      const next = await api.admin.credits()
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
            tokensPerCredit: String(next.settings!.tokensPerCredit),
            topupCredits: String(next.settings!.topupCredits),
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

  async function act(key: string, run: () => Promise<AdminCreditSnapshot>, success: string) {
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
      () => api.admin.decidePurchase(id, approve, approve ? 'Approved in the credit console.' : 'Declined.'),
      approve ? 'Request approved — the balance is updated.' : 'Request declined.'
    )
  }

  async function setPlan(userId: string, planId: string) {
    await act(`plan:${userId}`, () => api.admin.setPlan(userId, planId, 30), 'Plan changed for 30 days.')
  }

  async function grant(userId: string) {
    const amount = Math.round(Number(grantAmount))
    if (!Number.isFinite(amount) || amount === 0) {
      setError('Give an amount of credits, positive or negative.')
      return
    }
    await act(
      `grant:${userId}`,
      () => api.admin.grantCredits(userId, amount, grantReason),
      `${credits(amount)} credits applied.`
    )
    setGrantAmount('')
    setGrantReason('')
  }

  /** Saves every field of one tier, including whether it is still offered. */
  async function savePlan(plan: CreditPlan) {
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
      setError('A daily allowance is a whole number of credits, zero or more.')
      return
    }
    setBusy(`planEdit:${plan.id}`)
    setError(null)
    try {
      await api.admin.updatePlan({
        id: plan.id,
        name: draft.name,
        blurb: draft.blurb,
        dailyCredits: Math.round(daily),
        priceMinor
      })
      const next = await api.admin.credits()
      setSnapshot(next)
      setPlanDraft((current) => {
        const nextDraft: Record<string, PlanDraft> = {}
        for (const tier of next.plans) {
          nextDraft[tier.id] = tier.id === plan.id ? draftOf(tier, next.settings) : current[tier.id] ?? draftOf(tier, next.settings)
        }
        return nextDraft
      })
      toast.success(`${draft.name} saved: ${credits(daily)} credits a day.`)
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
        dailyCredits: Math.max(0, Math.round(Number(newPlan.daily) || 0)),
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

  async function toggleEnabled(plan: CreditPlan, enabled: boolean) {
    if (!enabled) {
      setConfirmOff(plan)
      return
    }
    await savePlanFlag(plan, true)
  }

  async function savePlanFlag(plan: CreditPlan, enabled: boolean) {
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
      tokensPerCredit: numeric(settingsDraft.tokensPerCredit),
      topupCredits: numeric(settingsDraft.topupCredits),
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
      const saved = await api.admin.updateCreditSettings({
        currency: payload.currency,
        symbol: payload.symbol,
        decimals: payload.decimals,
        tokensPerCredit: payload.tokensPerCredit ?? undefined,
        topupCredits: payload.topupCredits ?? undefined,
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
        tokensPerCredit: String(saved.tokensPerCredit),
        topupCredits: String(saved.topupCredits),
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

  async function openLedger(userId: string) {
    if (ledgerFor === userId) {
      setLedgerFor(null)
      return
    }
    setLedgerFor(userId)
    setBusy(`ledger:${userId}`)
    try {
      setLedger(await api.admin.creditLedger(userId, 40))
    } catch (caught) {
      setError(errorMessage(caught))
      setLedger([])
    } finally {
      setBusy(null)
    }
  }

  const pending = snapshot?.pending ?? []
  const decided = snapshot?.decided ?? []
  const signedIn = overview.sessionUserId
    ? overview.accounts.find((account) => account.id === overview.sessionUserId)?.displayName ?? 'an account'
    : null
  const symbol = settings?.symbol || '$'
  const decimals = settings?.decimals ?? 2

  return (
    <>
      <SectionHead
        title="Credits"
        description="Everything a credit costs, what each tier grants, what a top-up buys, and every movement of every balance. Prices are enforced by the server, not by this console."
      >
        <span className="admin-credits-live">
          <span
            className={`admin-chip-dot${snapshot?.live ? '' : ' admin-chip--muted'}`}
            aria-hidden="true"
          />
          {snapshot?.live ? 'Connected as a cloud administrator' : 'Read-only'}
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

      {snapshot && !snapshot.live && (
        <div className="notice mb-4 items-start">
          <span>
            {snapshot.message ??
              'This credit console needs an app account signed in whose cloud profile holds the administrator role.'}
            {signedIn ? ` Signed in on this PC as ${signedIn}.` : ' No account is signed in on this PC.'}
          </span>
        </div>
      )}

      {snapshot?.live && (
        <>
          <div className="admin-summary">
            <span>{pending.length} waiting</span>
            <span>{snapshot.accounts.length} accounts</span>
            <span>
              {snapshot.plans.filter((plan) => plan.enabled).length} of {snapshot.plans.length} tiers offered
            </span>
            {settings && (
              <span>
                priced in {settings.currency} · 1 credit = {credits(settings.tokensPerCredit)} tokens
              </span>
            )}
          </div>

          {/* ---------------- pricing rules ---------------- */}
          <section className="admin-card">
            <div className="admin-card-head">
              <h2>Pricing</h2>
              <span className="admin-card-count">
                {settings ? `saved ${formatDateTime(settings.updatedAt)}` : 'not read yet'}
              </span>
            </div>
            {settingsDraft ? (
              <div className="admin-card-body">
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
                    <span className="field-label">Tokens per credit</span>
                    <input
                      className="field-input"
                      inputMode="numeric"
                      value={settingsDraft.tokensPerCredit}
                      onChange={(event) =>
                        setSettingsDraft((current) =>
                          current
                            ? { ...current, tokensPerCredit: event.target.value.replace(/[^\d]/g, '') }
                            : current
                        )
                      }
                      aria-label="Tokens per credit"
                    />
                    <span className="admin-field-hint">What the AI function divides a model's tokens by.</span>
                  </label>
                  <label className="admin-field">
                    <span className="field-label">Pack size (credits)</span>
                    <input
                      className="field-input"
                      inputMode="numeric"
                      value={settingsDraft.topupCredits}
                      onChange={(event) =>
                        setSettingsDraft((current) =>
                          current ? { ...current, topupCredits: event.target.value.replace(/[^\d]/g, '') } : current
                        )
                      }
                      aria-label="Credits per pack"
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
                      {minorFrom(settingsDraft.topupPrice, decimals) !== null && Number(settingsDraft.topupCredits) > 0
                        ? `= ${money(minorFrom(settingsDraft.topupPrice, decimals) ?? 0, settings)} per pack · ${money(
                            Math.round(
                              (minorFrom(settingsDraft.topupPrice, decimals) ?? 0) / Math.max(Number(settingsDraft.topupCredits), 1)
                            ),
                            settings
                          )} per credit`
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
                        tokensPerCredit: String(settings.tokensPerCredit),
                        topupCredits: String(settings.topupCredits),
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
                <p className="admin-empty">
                  Prices are stored in whole minor units of {settings?.currency ?? 'the workspace currency'} — a
                  price of {money(199, settings)} is stored as 199. Changing the currency changes how prices are
                  read, not what they are worth in another country, so re-enter them after a change.
                </p>
              </div>
            ) : (
              <p className="admin-empty">Reading the pricing rules…</p>
            )}
          </section>

          {/* ---------------- tiers ---------------- */}
          <section className="admin-card">
            <div className="admin-card-head">
              <h2>Tiers</h2>
              <div className="admin-row-actions">
                <span className="admin-card-count">{snapshot.plans.length}</span>
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
                  <span className="field-label">Credits a day</span>
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
                    <span className="field-label">Credits a day</span>
                    <input
                      className="field-input"
                      inputMode="numeric"
                      value={draft.daily}
                      aria-label={`${plan.id} daily credits`}
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
            <p className="admin-empty">
              A tier that accounts are on cannot be switched off — move those accounts first. A change to an
              allowance applies from each account's next daily reset; existing balances are not rewritten.
            </p>
          </section>

          {/* ---------------- waiting ---------------- */}
          <section className="admin-card">
            <div className="admin-card-head">
              <h2>Waiting for an answer</h2>
              <span className="admin-card-count">{pending.length}</span>
            </div>
            {pending.length === 0 ? (
              <p className="admin-empty">Nothing is waiting. Requests appear here the moment they are made.</p>
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
                            : `Top-up · ${credits(request.credits ?? 0)} credits`}
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
          <section className="admin-card">
            <div className="admin-card-head">
              <h2>Accounts</h2>
              <SearchField value={query} onChange={setQuery} placeholder="Search accounts" />
            </div>
            {accounts.length === 0 ? (
              <p className="admin-empty">No account matches that search.</p>
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
                        <td className="admin-num">{credits(account.daily)}</td>
                        <td className="admin-num">{credits(account.purchased)}</td>
                        <td className="admin-num">{credits(account.total)}</td>
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
                          </div>

                          {openAccount === account.id && (
                            <div className="mt-2 flex flex-wrap items-end gap-2">
                              <label className="admin-field w-[110px]">
                                <span className="field-label">Credits</span>
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
                                  placeholder="Support credit"
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
            <section className="admin-card">
              <div className="admin-card-head">
                <h2>Ledger</h2>
                <span className="admin-card-count">{ledger.length}</span>
              </div>
              {ledger.length === 0 ? (
                <p className="admin-empty">No movements yet for this account.</p>
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
                            {credits(row.amount)}
                          </td>
                          <td className="admin-num">{credits(row.balanceAfter)}</td>
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

          <section className="admin-card">
            <div className="admin-card-head">
              <h2>Answered</h2>
              <span className="admin-card-count">{decided.length}</span>
            </div>
            {decided.length === 0 ? (
              <p className="admin-empty">No request has been answered yet.</p>
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
                            : `Top-up · ${credits(request.credits ?? 0)} credits`}
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
          The tier disappears from the Credits page. Accounts already on it keep it until they are
          moved, and the server refuses the change while any account is on it.
        </ConfirmDialog>
      )}
    </>
  )
}
