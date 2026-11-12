import { useState } from 'react'
import type { AdminAccount, AdminOverview } from '@shared/types'
import AccessSection from './AccessSection'
import AccountsSection from './AccountsSection'
import ActivitySection from './ActivitySection'
import ContentSection from './ContentSection'
import KeysSection from './KeysSection'
import OverviewSection from './OverviewSection'
import ProjectsSection from './ProjectsSection'
import SystemSection from './SystemSection'
import type { AdminSectionId } from './shared'

interface AdminPanelProps {
  admin: AdminAccount
  overview: AdminOverview
  refresh: () => Promise<void>
}

const NAV: Array<{ id: AdminSectionId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'projects', label: 'Projects' },
  { id: 'content', label: 'Content' },
  { id: 'keys', label: 'Activation keys' },
  { id: 'access', label: 'Access & controls' },
  { id: 'activity', label: 'Activity' },
  { id: 'system', label: 'System' }
]

export default function AdminPanel({ admin, overview, refresh }: AdminPanelProps) {
  const [section, setSection] = useState<AdminSectionId>('overview')

  const counts: Partial<Record<AdminSectionId, number>> = {
    accounts: overview.counts.accounts,
    projects: overview.counts.projects,
    content: overview.counts.documents + overview.counts.presentations,
    keys: overview.activationKeys.filter((key) => key.status === 'unused').length
  }

  return (
    <div className="admin-layout stagger">
      <nav className="admin-nav" aria-label="Administration sections">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`admin-nav-item${section === item.id ? ' admin-nav-item--active' : ''}`}
            aria-current={section === item.id ? 'page' : undefined}
            onClick={() => setSection(item.id)}
          >
            <span>{item.label}</span>
            {counts[item.id] !== undefined && (
              <span className="admin-nav-count">{counts[item.id]}</span>
            )}
          </button>
        ))}

        <div className="admin-nav-footer">
          <span className="micro-label">Administrator</span>
          <span className="admin-nav-email">{admin.email}</span>
        </div>
      </nav>

      <div className="admin-body">
        {section === 'overview' && (
          <OverviewSection overview={overview} refresh={refresh} onOpenSection={setSection} />
        )}
        {section === 'accounts' && <AccountsSection overview={overview} refresh={refresh} />}
        {section === 'projects' && <ProjectsSection overview={overview} refresh={refresh} />}
        {section === 'content' && <ContentSection overview={overview} refresh={refresh} />}
        {section === 'keys' && <KeysSection overview={overview} refresh={refresh} />}
        {section === 'access' && <AccessSection overview={overview} refresh={refresh} />}
        {section === 'activity' && <ActivitySection overview={overview} refresh={refresh} />}
        {section === 'system' && <SystemSection overview={overview} refresh={refresh} />}
      </div>
    </div>
  )
}
