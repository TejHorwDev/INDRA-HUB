import { redirect } from 'next/navigation'
import ReceiptButton from '@/components/ReceiptButton'
import { clientFor, requireUser } from '@/lib/auth'
import { db, eq } from '@/lib/db'
import { day, money } from '@/lib/format'
import { business } from '@/lib/settings'
import type { Payment, Project } from '@/lib/types'

export const dynamic = 'force-dynamic'

/*
 * What a client sees. Their own work, their own payments, their own receipts — and nothing
 * that could name somebody else. Every query below is filtered by the client id on the
 * session; there is no id in the URL to edit.
 */
export default async function Portal() {
  const user = await requireUser()
  if (user.role === 'owner') redirect('/dashboard')

  const client = await clientFor(user)
  if (!client) {
    return (
      <div className="card">
        <div className="body">
          <h2>Not linked yet</h2>
          <p className="note">This login is not attached to a client. Ask for it to be set up again.</p>
        </div>
      </div>
    )
  }

  const [projects, payments, { name: businessName, contact: businessContact }] = await Promise.all([
    db.select<Project>('svc_projects', `select=*&client_id=eq.${eq(client.id)}&order=created_at.desc`),
    db.select<Payment>('svc_payments', `select=*&client_id=eq.${eq(client.id)}&order=paid_on.desc`),
    business()
  ])

  const titles = new Map(projects.map((project) => [project.id, project.title]))
  let paidNPR = 0
  let paidUSD = 0
  for (const payment of payments) {
    if (payment.currency === 'USD') paidUSD += Number(payment.amount) || 0
    else paidNPR += Number(payment.amount) || 0
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>{client.name}</h1>
          <p>
            <span className="mono">{client.client_no}</span>
            {client.company ? ` · ${client.company}` : ''}
          </p>
        </div>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 22 }}>
        <div className="card stat">
          <small>Paid</small>
          <strong>{money(paidNPR, 'NPR')}</strong>
          <em>{paidUSD > 0 ? `plus ${money(paidUSD, 'USD')}` : `${payments.length} payments`}</em>
        </div>
        <div className="card stat">
          <small>Work delivered</small>
          <strong>{projects.length}</strong>
          <em>built for you</em>
        </div>
        <div className="card stat">
          <small>Receipts</small>
          <strong>{payments.length}</strong>
          <em>download any of them</em>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <header>
            <h2>Your payments</h2>
          </header>
          {payments.length === 0 ? (
            <p className="empty">No payments recorded yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Receipt</th>
                  <th className="num">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>
                      {day(payment.paid_on)}
                      <div className="sub">
                        {payment.project_id ? (titles.get(payment.project_id) ?? 'Work') : 'Service'}
                      </div>
                    </td>
                    <td className="mono">{payment.receipt_no}</td>
                    <td className="num">{money(Number(payment.amount), payment.currency)}</td>
                    <td className="num">
                      <ReceiptButton
                        label="Download"
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
            <h2>What was built</h2>
          </header>
          {projects.length === 0 ? (
            <p className="empty">Nothing listed yet.</p>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
