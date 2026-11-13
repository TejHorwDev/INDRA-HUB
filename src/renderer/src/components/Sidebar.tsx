import { NavLink, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { initialsOf } from '../lib/format'
import { navGroups } from '../lib/nav'
import { useSession } from '../lib/session'
import { useConnectivity } from '../lib/connectivity'
import { useInvitations } from '../lib/invitations'
import {
  CodeIcon,
  DashboardIcon,
  FileIcon,
  HomeIcon,
  PresentationIcon,
  SettingsIcon,
  SignOutIcon,
  SparkIcon
} from './icons'

/* The rail is data-driven (lib/nav.ts); this maps a path to its glyph. */
const ICONS: Record<string, ReactNode> = {
  '/home': <HomeIcon size={18} />,
  '/dashboard': <DashboardIcon size={18} />,
  '/documents': <FileIcon size={18} />,
  '/presentations': <PresentationIcon size={18} />,
  '/developers': <CodeIcon size={18} />,
  '/credits': <SparkIcon size={18} />,
  '/settings': <SettingsIcon size={18} />
}

/**
 * The rail.
 *
 * Five destinations do not need a 236px column of words. An icon rail keeps
 * the whole window for the page, names itself on hover, and puts the one
 * thing that changes — where you are — in a filled square with a bar at the
 * edge. The account lives at the bottom, where a desktop app puts it.
 */
export default function Sidebar() {
  const navigate = useNavigate()
  const { user, signOut } = useSession()
  const { offline } = useConnectivity()
  const invitations = useInvitations()
  const waiting = invitations.length

  async function handleSignOut(): Promise<void> {
    await signOut()
    navigate('/login', { replace: true })
  }

  // Online the rail is about projects; offline it is about the two things the
  // machine can do on its own. lib/nav.ts decides, so a simulation can check it.
  const groups = navGroups(offline || user?.mode === 'offline')
  const items = groups.flatMap((group) => group.items)

  return (
    <aside className="rail" aria-label="Primary">
      <div className="rail-top">
        <div className="rail-brand" title="INDRA HUB" aria-hidden="true">
          IH
        </div>

        <nav className="rail-nav" aria-label="Main">
          {items.map((item) => {
            const badge = item.to === '/home' && waiting > 0 ? waiting : null
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className="rail-item"
                aria-label={
                  badge ? `${item.label} — ${badge} invitations waiting` : item.label
                }
              >
                <span className="rail-icon">{ICONS[item.to]}</span>
                <span className="rail-label">{item.label}</span>
                {badge && <span className="rail-badge">{badge}</span>}
              </NavLink>
            )
          })}
        </nav>
      </div>

      <div className="rail-foot">
        {user && (
          <button
            type="button"
            className="rail-user"
            onClick={() => navigate('/settings')}
            aria-label={`Account — ${user.displayName}`}
          >
            <span className="avatar">{initialsOf(user.displayName)}</span>
            <span className="rail-label">{user.displayName}</span>
          </button>
        )}

        <button
          type="button"
          className="rail-item"
          onClick={() => void handleSignOut()}
          aria-label="Sign out"
        >
          <span className="rail-icon">
            <SignOutIcon size={17} />
          </span>
          <span className="rail-label">Sign out</span>
        </button>
      </div>
    </aside>
  )
}
