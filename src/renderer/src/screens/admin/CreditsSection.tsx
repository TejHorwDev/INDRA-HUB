import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AdminCreditLedgerRow, AdminCreditSnapshot, CreditPlan } from '@shared/types'
import { useToast } from '../../components/ToastProvider'
import { api, errorMessage } from '../../lib/api'
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
 * Plans are edited, not hardcoded: the daily allowance and the price of each
 * tier are rows on the server, so changing what a tier is worth never needs a
 * new build.
 */

const credits = (value: number): string => Math.round(value).toLocaleString('en-IN')

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
  const [planDraft, setPlanDraft] = useState<Record<string, { daily: string; price: string; name: string }>>({})

  const load = useCallback(async () => {
    try {
      const next = await api.admin.credits()
      setSnapshot(next)
      setPlanDraft((current) => {
        const draft: Record<string, { daily: string; price: string; name: string }> = {}
        for (const plan of next.plans) {
          draft[plan.id] = current[plan.id] ?? {
            name: plan.name,
            daily: String(plan.dailyCredits),
            price: String(plan.priceInr)
          }
        }
        return draft
      })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [toast])

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
    try {
      setSnapshot(await run())
      toast.success(success)
    } catch (error) {
      toast.error(errorMessage(error))
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
      toast.error('Give an amount of credits, positive or negative.')
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

  async function savePlan(plan: CreditPlan) {
    const draft = planDraft[plan.id]
    if (!draft) return
    setBusy(`planEdit:${plan.id}`)
    try {
      const plans = await api.admin.updatePlan({
        id: plan.id,
        name: draft.name,
        dailyCredits: Number(draft.daily),
        priceInr: Number(draft.price)
      })
      setSnapshot((current) => (current ? { ...current, plans } : current))
      toast.success(`${draft.name} is worth ${credits(Number(draft.daily))} credits a day.`)
    } catch (error) {
      toast.error(errorMessage(error))
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
      setLedger(await api.admin.creditLedger(userId, 40))
    } catch (error) {
      toast.error(errorMessage(error))
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

  return (
    <>
      <SectionHead
        title="Credits"
        description="Approve what people ask for, set what each tier is worth, and correct a balance when it needs correcting. Every movement is written to the account's ledger by the database."
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
            <span>{snapshot.plans.length} tiers</span>
          </div>

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
                          {request.amountInr === null ? '—' : `₹${request.amountInr}`}
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

          <section className="admin-card">
            <div className="admin-card-head">
              <h2>Tiers</h2>
              <span className="admin-card-count">{snapshot.plans.length}</span>
            </div>
            {snapshot.plans.map((plan) => {
              const draft = planDraft[plan.id] ?? { name: plan.name, daily: String(plan.dailyCredits), price: String(plan.priceInr) }
              return (
                <div className="admin-credit-plan-row" key={plan.id}>
                  <span className="admin-credit-name">{plan.id}</span>
                  <input
                    className="field-input"
                    value={draft.name}
                    aria-label={`${plan.id} name`}
                    onChange={(event) =>
                      setPlanDraft((current) => ({ ...current, [plan.id]: { ...draft, name: event.target.value } }))
                    }
                  />
                  <label className="flex items-center gap-2 text-xs text-[var(--ink-tertiary)]">
                    Daily
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
                  <label className="flex items-center gap-2 text-xs text-[var(--ink-tertiary)]">
                    ₹ / month
                    <input
                      className="field-input"
                      inputMode="numeric"
                      value={draft.price}
                      aria-label={`${plan.id} price`}
                      onChange={(event) =>
                        setPlanDraft((current) => ({
                          ...current,
                          [plan.id]: { ...draft, price: event.target.value.replace(/[^\d]/g, '') }
                        }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm w-auto"
                    disabled={busy !== null}
                    onClick={() => void savePlan(plan)}
                  >
                    {busy === `planEdit:${plan.id}` ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )
            })}
            <p className="admin-empty">
              A change here applies from each account's next daily reset. Existing balances are not
              rewritten — only what the next day grants.
            </p>
          </section>

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
    </>
  )
}
