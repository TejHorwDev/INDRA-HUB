import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import type { CSSProperties, ReactNode } from 'react'
import { initialsOf, toneOf } from '../lib/format'
import { useSession } from '../lib/session'
import { useConnectivity } from '../lib/connectivity'
import {
  ChevronLeftIcon,
  CodeIcon,
  DashboardIcon,
  FileIcon,
  HomeIcon,
  PresentationIcon,
  SettingsIcon,
  SignOutIcon,
  SparkIcon
} from './icons'

const STORAGE_KEY = 'indra-hub.sidebar'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/home', label: 'Home', icon: <HomeIcon size={16} /> },
      { to: '/dashboard', label: 'Projects', icon: <DashboardIcon size={16} /> },
      { to: '/documents', label: 'Documents', icon: <FileIcon size={16} /> },
      { to: '/presentations', label: 'Presentations', icon: <PresentationIcon size={16} /> },
      { to: '/developers', label: 'Developers', icon: <CodeIcon size={16} /> }
    ]
  },
  {
    label: 'Account',
    items: [
      { to: '/credits', label: 'Credits', icon: <SparkIcon size={16} /> },
      { to: '/settings', label: 'Settings', icon: <SettingsIcon size={16} /> }
    ]
  }
]

/**
 * With no route out, the rail keeps only what the machine can do on its own.
 * Hiding the rest is kinder than letting someone click into a screen that has
 * nothing to show them.
 */
const OFFLINE_ALLOWED = new Set(['/documents', '/presentations', '/dashboard', '/settings'])

export default function Sidebar() {
  const navigate = useNavigate()
  const { user, signOut } = useSession()
  const { offline } = useConnectivity()

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === 'collapsed'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? 'collapsed' : 'expanded')
    } catch {
      // Non-critical: the sidebar still collapses for this session.
    }
  }, [collapsed])

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  // Offline the rail keeps one group, and it drops the headings rather than
  // leaving "Workspace" over a list of two.
  const groups = offline
    ? [
        {
          label: 'Offline',
          items: NAV_GROUPS.flatMap((group) =>
            group.items.filter((item) => OFFLINE_ALLOWED.has(item.to))
          )
        }
      ]
    : NAV_GROUPS

  return (
    <aside className={collapsed ? 'sidebar sidebar--collapsed' : 'sidebar'} aria-label="Primary">
      <nav className="flex flex-col" aria-label="Main">
        {groups.map((group) => (
          <div className="sidebar-group" key={group.label}>
            <div className="sidebar-group-label">{group.label}</div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `sidebar-item${isActive ? ' sidebar-item--active' : ''}`
                }
                title={collapsed ? item.label : undefined}
              >
                <span className="sidebar-icon">{item.icon}</span>
                <span className="sidebar-label">{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        {user && (
          <div
            className="sidebar-user"
            title={collapsed ? `${user.displayName} (@${user.username})` : undefined}
          >
            <span className="avatar" style={{ '--tone': toneOf(user.id) } as CSSProperties}>
              {initialsOf(user.displayName)}
            </span>
            <span className="sidebar-label sidebar-user-text">
              <span className="sidebar-user-name">{user.displayName}</span>
              <span className="sidebar-user-handle">@{user.username}</span>
            </span>
            {!collapsed && (
              <button
                type="button"
                className="icon-button sidebar-signout"
                onClick={() => void handleSignOut()}
                title="Sign out"
                aria-label="Sign out"
              >
                <SignOutIcon size={14} />
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          className="sidebar-item"
          onClick={() => setCollapsed((current) => !current)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
        >
          <span
            className="sidebar-icon"
            style={{
              transform: collapsed ? 'rotate(180deg)' : undefined,
              transition: 'transform var(--dur-base) var(--ease)'
            }}
          >
            <ChevronLeftIcon size={15} />
          </span>
          <span className="sidebar-label">Collapse</span>
        </button>
      </div>
    </aside>
  )
}
