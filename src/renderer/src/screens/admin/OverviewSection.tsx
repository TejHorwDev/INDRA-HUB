import { SparkIcon } from '../../components/icons'
import { AUDIT_LABELS, Badge, SectionHead, formatDate, formatDateTime } from './shared'
import type { AdminSectionId, SectionProps } from './shared'

interface OverviewProps extends SectionProps {
  onOpenSection: (section: AdminSectionId) => void
}

export default function OverviewSection({ overview, onOpenSection }: OverviewProps) {
  const { counts, settings, admin, accounts, projects } = overview
  const suspended = accounts.filter((account) => account.suspendedAt).length
  const sessionAccount = accounts.find((account) => account.id === overview.sessionUserId)

  const stats = [
    { label: 'Accounts', value: counts.accounts, section: 'accounts' as const },
    { label: 'Projects', value: counts.projects, section: 'projects' as const },
    { label: 'Documents', value: counts.documents, section: 'content' as const },
    { label: 'Presentations', value: counts.presentations, section: 'content' as const },
    { label: 'Slides', value: counts.slides, section: 'content' as const },
    { label: 'Memberships', value: counts.memberships, section: 'accounts' as const }
  ]

  return (
    <>
      <SectionHead
        title="Installation overview"
        description={`${admin.displayName} · ${admin.email}`}
      >
        <div className="admin-meta">
          <span>Created {formatDate(admin.createdAt)}</span>
          <span>Last sign-in {formatDate(admin.lastSignInAt)}</span>
        </div>
      </SectionHead>

      <section className="admin-stat-grid" aria-label="Installation totals">
        {stats.map((stat) => (
          <button
            key={stat.label}
            type="button"
            className="admin-stat admin-stat--link"
            onClick={() => onOpenSection(stat.section)}
          >
            <span className="micro-label">{stat.label}</span>
            <span className="admin-stat-value">{stat.value}</span>
          </button>
        ))}
      </section>

      <div className="admin-split">
        <section className="admin-card" aria-labelledby="admin-state-title">
          <div className="admin-card-head">
            <h2 id="admin-state-title">App state</h2>
            <button type="button" className="admin-link" onClick={() => onOpenSection('access')}>
              Manage
            </button>
          </div>
          <dl className="admin-kv">
            <div>
              <dt>Availability</dt>
              <dd>
                {settings.maintenanceMode ? (
                  <Badge tone="warn">Maintenance on</Badge>
                ) : (
                  <Badge tone="good">Live</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt>New accounts</dt>
              <dd>
                {settings.allowRegistration ? (
                  <Badge>Open</Badge>
                ) : (
                  <Badge tone="warn">Closed</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt>Suspended</dt>
              <dd>
                {suspended} of {accounts.length}
              </dd>
            </div>
            <div>
              <dt>Signed in here</dt>
              <dd>{sessionAccount ? sessionAccount.displayName : 'Nobody'}</dd>
            </div>
          </dl>
          {settings.maintenanceMode && (
            <p className="admin-warning admin-warning--inset">{settings.maintenanceMessage}</p>
          )}
        </section>

        <section className="admin-card" aria-labelledby="admin-ai-title">
          <div className="admin-card-head">
            <h2 id="admin-ai-title">
              <SparkIcon size={14} />
              AI provider
            </h2>
            <span className="admin-status">Not configured</span>
          </div>
          <div className="admin-card-body">
            <div className="admin-key-slot">
              <span className="micro-label">API key</span>
              <span className="admin-key-placeholder">Placeholder — no key set</span>
            </div>
            <p className="admin-hint">
              AI-assisted conversion and credit accounting are not connected in this build. The API
              key will be added here later; until then every document-to-presentation conversion uses
              the offline engine and spends nothing.
            </p>
          </div>
        </section>
      </div>

      <section className="admin-card" aria-labelledby="admin-recent-title">
        <div className="admin-card-head">
          <h2 id="admin-recent-title">Recent administrator activity</h2>
          <button type="button" className="admin-link" onClick={() => onOpenSection('activity')}>
            View all
          </button>
        </div>
        {overview.audit.length === 0 ? (
          <p className="admin-empty">No administrator activity recorded yet.</p>
        ) : (
          <ul className="admin-audit">
            {overview.audit.slice(0, 5).map((entry) => (
              <li key={entry.id}>
                <span className="admin-audit-time">{formatDateTime(entry.createdAt)}</span>
                <span className="admin-audit-action">
                  {AUDIT_LABELS[entry.action] ?? entry.action}
                </span>
                <span className="admin-audit-detail">{entry.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="admin-footnote">
        {projects.length} project{projects.length === 1 ? '' : 's'} across {accounts.length} account
        {accounts.length === 1 ? '' : 's'}. The panel only ever shows data that exists in the local
        database.
      </p>
    </>
  )
}
