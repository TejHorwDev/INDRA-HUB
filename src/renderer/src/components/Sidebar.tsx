import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { initialsOf } from '../lib/format'
import { navGroups } from '../lib/nav'
import { useSession } from '../lib/session'
import { useConnectivity } from '../lib/connectivity'
import { useInvitations } from '../lib/invitations'
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

/* The rail is data-driven (lib/nav.ts); this maps a path to its glyph. */
const ICONS: Record<string, ReactNode> = {
  '/home': <HomeIcon size={16} />,
  '/dashboard': <DashboardIcon size={16} />,
  '/documents': <FileIcon size={16} />,
  '/presentations': <PresentationIcon size={16} />,
  '/developers': <CodeIcon size={16} />,
  '/credits': <SparkIcon size={16} />,
  '/settings': <SettingsIcon size={16} />
}

export default function Sidebar() {
  const navigate = useNavigate()
  const { user, signOut } = useSession()
  const { offline } = useConnectivity()
  const invitations = useInvitations()
  // A count on Home, because that is where an invitation is answered.
  const waiting = invitations.length

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

  // Online the rail is about projects; offline it is about the two things the
  // machine can do on its own. lib/nav.ts decides, so a simulation can check it.
  const groups = navGroups(offline || user?.mode === 'offline')

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
                title={
                  collapsed
                    ? item.to === '/home' && waiting > 0
                      ? `${item.label} — ${waiting} waiting`
                      : item.label
                    : undefined
                }
              >
                <span className="sidebar-icon">{ICONS[item.to]}</span>
                <span className="sidebar-label">{item.label}</span>
                {item.to === '/home' && waiting > 0 && (
                  <span
                    className="sidebar-badge"
                    aria-label={`${waiting} ${waiting === 1 ? 'invitation' : 'invitations'} waiting`}
                  >
                    {waiting}
                  </span>
                )}
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
            <span className="avatar">
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
