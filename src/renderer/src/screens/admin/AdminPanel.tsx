import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { AdminAccount, AdminOverview } from '@shared/types'
import {
  BellIcon,
  ChevronLeftIcon,
  DashboardIcon,
  FileIcon,
  FolderIcon,
  InfoIcon,
  PaletteIcon,
  SettingsIcon,
  SignOutIcon,
  SparkIcon,
  UserIcon,
  WalletIcon,
  WindowIcon
} from '../../components/icons'
import AccessSection from './AccessSection'
import AccountsSection from './AccountsSection'
import AppearanceSection from './AppearanceSection'
import ActivitySection from './ActivitySection'
import BackendPanel from '../../components/BackendPanel'
import WorkspacePanel from '../../components/WorkspacePanel'
import ContentSection from './ContentSection'
import CreditsSection from './CreditsSection'
import KeysSection from './KeysSection'
import OverviewSection from './OverviewSection'
import ProjectsSection from './ProjectsSection'
import SystemSection from './SystemSection'
import type { AdminSectionId } from './shared'

interface AdminPanelProps {
  admin: AdminAccount
  overview: AdminOverview
  refresh: () => Promise<void>
  /** Ends the administrator session; the gate screen takes over from there. */
  onSignOut: () => void
}

interface NavItem {
  id: AdminSectionId
  label: string
  icon: ReactNode
}

/*
 * Grouped by what the administrator is doing, not alphabetically: the day to
 * day (workspace), the levers (control), and the machine itself (platform).
 */
const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Workspace',
    items: [
      { id: 'overview', label: 'Overview', icon: <DashboardIcon size={15} /> },
      { id: 'accounts', label: 'Accounts', icon: <UserIcon size={15} /> },
      { id: 'projects', label: 'Projects', icon: <FolderIcon size={15} /> },
      { id: 'content', label: 'Content', icon: <FileIcon size={15} /> }
    ]
  },
  {
    label: 'Control',
    items: [
      { id: 'keys', label: 'Activation keys', icon: <SparkIcon size={15} /> },
      { id: 'credits', label: 'Credits', icon: <WalletIcon size={15} /> },
      { id: 'access', label: 'Access & controls', icon: <SettingsIcon size={15} /> },
      { id: 'appearance', label: 'Appearance', icon: <PaletteIcon size={15} /> }
    ]
  },
  {
    label: 'Platform',
    items: [
      { id: 'backend', label: 'Cloud & sync', icon: <WindowIcon size={15} /> },
      { id: 'activity', label: 'Activity', icon: <BellIcon size={15} /> },
      { id: 'system', label: 'System', icon: <InfoIcon size={15} /> }
    ]
  }
]

export default function AdminPanel({ admin, overview, refresh, onSignOut }: AdminPanelProps) {
  const [section, setSection] = useState<AdminSectionId>('overview')

  const counts: Partial<Record<AdminSectionId, number>> = {
    accounts: overview.counts.accounts,
    projects: overview.counts.projects,
    content: overview.counts.documents + overview.counts.presentations,
    keys: overview.activationKeys.filter((key) => key.status === 'unused').length
  }

  const { settings, appearance } = overview
  const initial = (admin.displayName || admin.email).trim().charAt(0).toUpperCase()

  return (
    <div className="admin-console">
      <aside className="admin-side">
        <div className="admin-side-head">
          <span className="admin-side-eyebrow">
            <span className="admin-side-eyebrow-mark" aria-hidden="true" />
            Administration
          </span>
          <p className="admin-side-title">Control room</p>
          <p className="admin-side-sub">Every switch in the installation, in one place.</p>
        </div>

        <nav className="admin-nav" aria-label="Administration sections">
          {NAV_GROUPS.map((group) => (
            <div className="admin-nav-group" key={group.label}>
              <p className="admin-nav-label">{group.label}</p>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`admin-nav-item${section === item.id ? ' admin-nav-item--active' : ''}`}
                  aria-current={section === item.id ? 'page' : undefined}
                  onClick={() => setSection(item.id)}
                >
                  <span className="admin-nav-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="admin-nav-text">{item.label}</span>
                  {counts[item.id] !== undefined && (
                    <span className="admin-nav-count">{counts[item.id]}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="admin-side-foot">
          <div className="admin-side-identity">
            <span className="admin-avatar" aria-hidden="true">
              {initial}
            </span>
            <div className="admin-identity">
              <p className="admin-identity-name">{admin.displayName}</p>
              <p className="admin-identity-email">{admin.email}</p>
            </div>
          </div>

          <div className="admin-side-actions">
            <Link to="/dashboard" className="admin-side-action">
              <ChevronLeftIcon size={13} />
              Back to app
            </Link>
            <button type="button" className="admin-side-action" onClick={onSignOut}>
              <SignOutIcon size={13} />
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="admin-main">
        <div className="admin-toolbar">
          <div className="admin-toolbar-chips">
            <button
              type="button"
              className={`admin-chip${settings.maintenanceMode ? ' admin-chip--alert' : ' admin-chip--good'}`}
              onClick={() => setSection('access')}
              title="Change this in Access & controls"
            >
              <span className="admin-chip-dot" aria-hidden="true" />
              {settings.maintenanceMode ? 'Maintenance on' : 'Workspace open'}
            </button>

            <button
              type="button"
              className={`admin-chip${settings.allowRegistration ? ' admin-chip--good' : ' admin-chip--muted'}`}
              onClick={() => setSection('access')}
              title="Change this in Access & controls"
            >
              <span className="admin-chip-dot" aria-hidden="true" />
              {settings.allowRegistration ? 'Registration open' : 'Registration closed'}
            </button>

            {appearance.background && (
              <button
                type="button"
                className="admin-chip admin-chip--muted"
                onClick={() => setSection('appearance')}
                title="Change this in Appearance"
              >
                <span className="admin-chip-dot" aria-hidden="true" />
                Sign-in video
              </button>
            )}
          </div>

          <span className="admin-toolbar-hint">Ctrl+Alt+A</span>
        </div>

        <div className="admin-body">
          {section === 'overview' && (
            <OverviewSection overview={overview} refresh={refresh} onOpenSection={setSection} />
          )}
          {section === 'accounts' && <AccountsSection overview={overview} refresh={refresh} />}
          {section === 'projects' && <ProjectsSection overview={overview} refresh={refresh} />}
          {section === 'content' && <ContentSection overview={overview} refresh={refresh} />}
          {section === 'keys' && <KeysSection overview={overview} refresh={refresh} />}
          {section === 'credits' && <CreditsSection overview={overview} refresh={refresh} />}
          {section === 'access' && <AccessSection overview={overview} refresh={refresh} />}
          {section === 'appearance' && (
            <AppearanceSection overview={overview} refresh={refresh} />
          )}
          {section === 'backend' && (
            // Machine-level configuration: only reachable behind the admin gate,
            // and the main process refuses these calls without an admin session.
            <>
              <WorkspacePanel />
              <BackendPanel />
            </>
          )}
          {section === 'activity' && <ActivitySection overview={overview} refresh={refresh} />}
          {section === 'system' && <SystemSection overview={overview} refresh={refresh} />}
        </div>
      </main>
    </div>
  )
}
