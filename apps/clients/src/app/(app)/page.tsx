import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/app/actions'
import { requireUser, type ClientRow } from '@/lib/auth'
import { db } from '@/lib/db'
import { day, money } from '@/lib/format'
import type { Payment, Project } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const user = await requireUser()
  if (user.role !== 'owner') redirect('/me')

  const { e } = await searchParams

  const [clients, payments, projects] = await Promise.all([
    db.select<ClientRow>('svc_clients', 'select=*&order=created_at.desc'),
    db.select<Payment>('svc_payments', 'select=*&order=paid_on.desc'),
    db.select<Project>('svc_projects', 'select=id,client_id,title')
  ])

  const collected = { NPR: 0, USD: 0 }
  const month = { NPR: 0, USD: 0 }
  const stamp = new Date().toISOString().slice(0, 7)

  for (const payment of payments) {
    const amount = Number(payment.amount)
    if (!Number.isFinite(amount)) continue
    const bucket = payment.currency === 'USD' ? 'USD' : 'NPR'
    collected[bucket] += amount
    if (payment.paid_on?.slice(0, 7) === stamp) month[bucket] += amount
  }

  const perClient = new Map<string, { NPR: number; USD: number }>()
  for (const payment of payments) {
    const bucket = payment.currency === 'USD' ? 'USD' : 'NPR'
    const row = perClient.get(payment.client_id) ?? { NPR: 0, USD: 0 }
    row[bucket] += Number(payment.amount) || 0
    perClient.set(payment.client_id, row)
  }

  const projectCount = projects.reduce<Record<string, number>>((all, project) => {
    all[project.client_id] = (all[project.client_id] ?? 0) + 1
    return all
  }, {})

  return (
    <>
      <div className="head">
        <div>
          <h1>Clients</h1>
          <p>{clients.length === 0 ? 'Nobody yet — the first name goes below.' : `${clients.length} on the books`}</p>
        </div>
      </div>

      {e ? <p className="error" style={{ marginBottom: 16 }}>{e}</p> : null}

      <div className="grid cols-3" style={{ marginBottom: 22 }}>
        <div className="card stat">
          <small>Collected</small>
          <strong>{money(collected.NPR, 'NPR')}</strong>
          <em>{collected.USD > 0 ? `plus ${money(collected.USD, 'USD')}` : 'all time'}</em>
        </div>
        <div className="card stat">
          <small>This month</small>
          <strong>{money(month.NPR, 'NPR')}</strong>
          <em>{month.USD > 0 ? `plus ${money(month.USD, 'USD')}` : new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</em>
        </div>
        <div className="card stat">
          <small>Work delivered</small>
          <strong>{projects.length}</strong>
          <em>{clients.length} {clients.length === 1 ? 'client' : 'clients'}</em>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <header>
            <h2>On the books</h2>
          </header>
          {clients.length === 0 ? (
            <p className="empty">No clients yet. Add the first one on the right.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Contact</th>
                  <th className="num">Work</th>
                  <th className="num">Paid</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => {
                  const paid = perClient.get(client.id) ?? { NPR: 0, USD: 0 }
                  return (
                    <tr key={client.id}>
                      <td>
                        <Link href={`/c/${client.id}`}>
                          <div className="name">{client.name}</div>
                          <div className="sub">
                            {client.company ? `${client.company} · ` : ''}
                            <span className="mono">{client.client_no}</span>
                          </div>
                        </Link>
                      </td>
                      <td className="sub">{client.phone || client.email || '—'}</td>
                      <td className="num sub">{projectCount[client.id] ?? 0}</td>
                      <td className="num">
                        {paid.NPR > 0 ? money(paid.NPR, 'NPR') : '—'}
                        {paid.USD > 0 ? <div className="sub">{money(paid.USD, 'USD')}</div> : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <header>
            <h2>New client</h2>
          </header>
          <div className="body">
            <form className="stack" action={createClient}>
              <div className="field">
                <label htmlFor="name">Name</label>
                <input id="name" name="name" required placeholder="Who you built it for" />
              </div>
              <div className="row2">
                <div className="field">
                  <label htmlFor="company">Business</label>
                  <input id="company" name="company" placeholder="Optional" />
                </div>
                <div className="field">
                  <label htmlFor="phone">Phone</label>
                  <input id="phone" name="phone" placeholder="Optional" />
                </div>
              </div>
              <div className="row2">
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input id="email" name="email" type="email" placeholder="Optional" />
                </div>
                <div className="field">
                  <label htmlFor="country">Country</label>
                  <input id="country" name="country" placeholder="Optional" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="notes">Notes</label>
                <textarea id="notes" name="notes" rows={2} placeholder="Anything worth remembering" />
              </div>
              <button type="submit">Add client</button>
              <p className="note">
                Client numbers are handed out in order — CL-001, CL-002 — and never reused.
              </p>
            </form>
          </div>
        </div>
      </div>

      <p className="note" style={{ marginTop: 22 }}>
        Latest payment: {payments[0] ? `${money(Number(payments[0].amount), payments[0].currency)} on ${day(payments[0].paid_on)}` : 'none recorded yet'}
      </p>
    </>
  )
}
