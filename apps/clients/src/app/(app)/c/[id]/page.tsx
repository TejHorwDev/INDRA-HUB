import { notFound, redirect } from 'next/navigation'
import { createPayment, createProject, deleteClient, deletePayment, deleteWork, setPortalAccess, setWorkStatus } from '@/app/actions'
import ReceiptButton from '@/components/ReceiptButton'
import { requireUser, type ClientRow } from '@/lib/auth'
import { db, eq } from '@/lib/db'
import { day, money } from '@/lib/format'
import { business } from '@/lib/settings'
import { KINDS, METHODS, type Payment, type Project } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function ClientPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ e?: string }>
}) {
  const user = await requireUser()
  if (user.role !== 'owner') redirect('/me')

  const { id } = await params
  const { e } = await searchParams

  const clients = await db.select<ClientRow>('svc_clients', `select=*&id=eq.${eq(id)}`)
  const client = clients[0]
  if (!client) notFound()

  const [projects, payments, portals, { name: businessName, contact: businessContact }] = await Promise.all([
    db.select<Project>('svc_projects', `select=*&client_id=eq.${eq(id)}&order=created_at.desc`),
    db.select<Payment>('svc_payments', `select=*&client_id=eq.${eq(id)}&order=paid_on.desc`),
    db.select<{ id: string; username: string; status: string }>(
      'svc_users',
      `select=id,username,status&client_id=eq.${eq(id)}`
    ),
    business()
  ])

  const portal = portals[0] ?? null
  const titles = new Map(projects.map((project) => [project.id, project.title]))

  const paid = { NPR: 0, USD: 0 }
  const billed = { NPR: 0, USD: 0 }
  for (const payment of payments) {
    const bucket = payment.currency === 'USD' ? 'USD' : 'NPR'
    paid[bucket] += Number(payment.amount) || 0
  }
  for (const project of projects) {
    const bucket = project.currency === 'USD' ? 'USD' : 'NPR'
    billed[bucket] += Number(project.price) || 0
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <>
      <div className="head">
        <div>
          <h1>{client.name}</h1>
          <p>
            {[client.company, client.country].filter(Boolean).join(' · ') || 'No business name'} ·{' '}
            <span className="mono">{client.client_no}</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {client.phone ? <span className="pill">{client.phone}</span> : null}
          {client.email ? <span className="pill">{client.email}</span> : null}
          {portal ? <span className="pill ok">portal</span> : null}
          <details className="menu">
            <summary className="ghost small">⋯</summary>
            <div className="menu-panel">
              <form action={deleteClient}>
                <input type="hidden" name="client_id" value={client.id} />
                <button type="submit" className="quiet small">
                  Delete client &amp; all their records
                </button>
              </form>
            </div>
          </details>
        </div>
      </div>

      {e ? <p className="error" style={{ marginBottom: 16 }}>{e}</p> : null}

      <div className="grid cols-3" style={{ marginBottom: 22 }}>
        <div className="card stat">
          <small>Paid</small>
          <strong>{money(paid.NPR, 'NPR')}</strong>
          <em>{paid.USD > 0 ? `plus ${money(paid.USD, 'USD')}` : `${payments.length} payments`}</em>
        </div>
        <div className="card stat">
          <small>Billed</small>
          <strong>{money(billed.NPR, 'NPR')}</strong>
          <em>{billed.USD > 0 ? `plus ${money(billed.USD, 'USD')}` : `${projects.length} items`}</em>
        </div>
        <div className="card stat">
          <small>Outstanding</small>
          <strong>{money(Math.max(0, billed.NPR - paid.NPR), 'NPR')}</strong>
          <em>what is still owed</em>
        </div>
      </div>

      <div className="grid cols-2">
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <div className="card">
            <header>
              <h2>Payments</h2>
              <span className="sub">{payments.length}</span>
            </header>
            {payments.length === 0 ? (
              <p className="empty">Nothing recorded yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>For</th>
                    <th className="num">Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td>
                        <div>{day(payment.paid_on)}</div>
                        <div className="mono">{payment.receipt_no}</div>
                      </td>
                      <td className="sub">
                        {payment.project_id ? (titles.get(payment.project_id) ?? 'Work') : 'Service'}
                        {payment.method ? ` · ${payment.method}` : ''}
                      </td>
                      <td className="num">{money(Number(payment.amount), payment.currency)}</td>
                      <td className="num">
                        <form action={deletePayment} style={{ display: 'inline' }}>
                          <input type="hidden" name="payment_id" value={payment.id} />
                          <input type="hidden" name="client_id" value={client.id} />
                          <button type="submit" className="ghost small" title="Delete this payment">
                            ✕
                          </button>
                        </form>{' '}
                        <ReceiptButton
                          data={{
                            no: payment.receipt_no,
                            date: payment.paid_on,
                            amount: Number(payment.amount),
                            currency: payment.currency,
                            method: payment.method,
                            reference: payment.reference,
                            note: payment.note,
                            item: payment.project_id ? (titles.get(payment.project_id) ?? 'Work') : 'Service',
                            clientName: client.name,
                            clientCompany: client.company,
                            clientNo: client.client_no,
                            businessName,
                            businessContact
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <header>
              <h2>Record a payment</h2>
            </header>
            <div className="body">
              <form className="stack" action={createPayment}>
                <input type="hidden" name="client_id" value={client.id} />
                <div className="row2">
                  <div className="field">
                    <label htmlFor="amount">Amount</label>
                    <input id="amount" name="amount" type="number" step="0.01" min="1" required placeholder="0" />
                  </div>
                  <div className="field">
                    <label htmlFor="currency">Currency</label>
                    <select id="currency" name="currency" defaultValue="NPR">
                      <option value="NPR">NPR</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                </div>
                <div className="row2">
                  <div className="field">
                    <label htmlFor="paid_on">Paid on</label>
                    <input id="paid_on" name="paid_on" type="date" defaultValue={today} />
                  </div>
                  <div className="field">
                    <label htmlFor="method">Method</label>
                    <select id="method" name="method" defaultValue="eSewa">
                      {METHODS.map((method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="row2">
                  <div className="field">
                    <label htmlFor="project_id">For which work</label>
                    <select id="project_id" name="project_id" defaultValue="">
                      <option value="">General / service</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="reference">Reference</label>
                    <input id="reference" name="reference" placeholder="Txn id, optional" />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="note">Note on the receipt</label>
                  <input id="note" name="note" placeholder="Optional — printed on the PNG" />
                </div>
                <button type="submit">Record payment</button>
                <p className="note">A receipt number is issued automatically. It never changes.</p>
              </form>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <div className="card">
            <header>
              <h2>Work</h2>
              <span className="sub">{projects.length}</span>
            </header>
            {projects.length === 0 ? (
              <p className="empty">Nothing yet.</p>
            ) : (
              <table>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id}>
                      <td>
                        <div className="name">{project.title}</div>
                        <div className="sub">
                          {project.kind}
                          {project.delivered_on ? ` · ${day(project.delivered_on)}` : ''}
                          {project.url ? (
                            <>
                              {' · '}
                              <a href={project.url} target="_blank" rel="noreferrer">
                                open
                              </a>
                            </>
                          ) : null}
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <span className={project.status === 'delivered' ? 'pill ok' : 'pill'}>
                            {project.status === 'delivered' ? 'delivered' : 'in progress'}
                          </span>
                        </div>
                      </td>
                      <td className="num">
                        {Number(project.price) > 0 ? money(Number(project.price), project.currency) : '—'}
                      </td>
                      <td className="num">
                        <form action={setWorkStatus} style={{ display: 'inline' }}>
                          <input type="hidden" name="project_id" value={project.id} />
                          <input type="hidden" name="client_id" value={client.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={project.status === 'delivered' ? 'in_progress' : 'delivered'}
                          />
                          <button type="submit" className="quiet small">
                            {project.status === 'delivered' ? 'Reopen' : 'Mark delivered'}
                          </button>
                        </form>{' '}
                        <form action={deleteWork} style={{ display: 'inline' }}>
                          <input type="hidden" name="project_id" value={project.id} />
                          <input type="hidden" name="client_id" value={client.id} />
                          <button type="submit" className="ghost small" title="Delete this work">
                            ✕
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <header>
              <h2>Add work</h2>
            </header>
            <div className="body">
              <form className="stack" action={createProject}>
                <input type="hidden" name="client_id" value={client.id} />
                <div className="field">
                  <label htmlFor="title">What you built</label>
                  <input id="title" name="title" required placeholder="Their app, panel, site…" />
                </div>
                <div className="row2">
                  <div className="field">
                    <label htmlFor="kind">Kind</label>
                    <select id="kind" name="kind" defaultValue="app">
                      {KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="delivered_on">Delivered</label>
                    <input id="delivered_on" name="delivered_on" type="date" defaultValue={today} />
                  </div>
                </div>
                <div className="row2">
                  <div className="field">
                    <label htmlFor="price">Price</label>
                    <input id="price" name="price" type="number" step="0.01" min="0" placeholder="0" />
                  </div>
                  <div className="field">
                    <label htmlFor="currency">Currency</label>
                    <select id="currency" name="currency" defaultValue="NPR">
                      <option value="NPR">NPR</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="url">Link</label>
                  <input id="url" name="url" placeholder="https://… optional" />
                </div>
                <div className="field">
                  <label htmlFor="summary">Line for the public page</label>
                  <input id="summary" name="summary" placeholder="One sentence — shown once delivered" />
                </div>
                <button type="submit">Add work</button>
              </form>
            </div>
          </div>

          <div className="card">
            <header>
              <h2>Client login</h2>
              {portal ? <span className="pill ok">on</span> : null}
            </header>
            <div className="body">
              <form className="stack" action={setPortalAccess}>
                <input type="hidden" name="client_id" value={client.id} />
                {portal ? (
                  <p className="note">
                    They sign in as <strong>{portal.username}</strong> and see only their own work and
                    receipts. Setting a new password signs them out everywhere.
                  </p>
                ) : (
                  <p className="note">Give them a login to see their own payments and download receipts.</p>
                )}
                <div className="field">
                  <label htmlFor="username">Username</label>
                  <input
                    id="username"
                    name="username"
                    defaultValue={portal?.username ?? ''}
                    placeholder={client.client_no.toLowerCase()}
                  />
                </div>
                <div className="field">
                  <label htmlFor="password">{portal ? 'New password' : 'Password'}</label>
                  <input id="password" name="password" type="text" minLength={8} required placeholder="At least 8 characters" />
                </div>
                <button type="submit" className="quiet">
                  {portal ? 'Reset their password' : 'Create their login'}
                </button>
              </form>
            </div>
          </div>

          {client.notes ? (
            <div className="card">
              <header>
                <h2>Notes</h2>
              </header>
              <div className="body">
                <p className="note">{client.notes}</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
