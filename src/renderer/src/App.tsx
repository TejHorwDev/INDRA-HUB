import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import AppShell from './components/AppShell'
import CommandPalette from './components/CommandPalette'
import type { Command } from './components/CommandPalette'
import OfflineScreen from './screens/OfflineScreen'
import TitleBar from './components/TitleBar'
import {
  CodeIcon,
  DashboardIcon,
  FileIcon,
  HomeIcon,
  PresentationIcon,
  MoonIcon,
  SettingsIcon,
  SignOutIcon,
  SparkIcon,
  SunIcon,
  UserIcon
} from './components/icons'
import { useToast } from './components/ToastProvider'
import {
  clearInvitations,
  refreshInvitations,
  useInvitations
} from './lib/invitations'
import { isLibraryPath, navDestinations } from './lib/nav'
import { useAppStatus } from './lib/appStatus'
import { routeAllowedOffline, useConnectivity } from './lib/connectivity'
import { useSession } from './lib/session'
import { useTheme } from './lib/theme'
import AdminScreen from './screens/AdminScreen'
import CreditsScreen from './screens/CreditsScreen'
import DashboardScreen from './screens/DashboardScreen'
import HomeScreen from './screens/HomeScreen'
import DevelopersScreen from './screens/DevelopersScreen'
import DocumentEditorScreen from './screens/DocumentEditorScreen'
import DocumentsScreen from './screens/DocumentsScreen'
import LibraryScreen from './screens/LibraryScreen'
import OpeningScreen from './components/OpeningScreen'
import LoginScreen from './screens/LoginScreen'
import MaintenanceScreen from './screens/MaintenanceScreen'
import PresentationEditorScreen from './screens/PresentationEditorScreen'
import PresentationsScreen from './screens/PresentationsScreen'
import ProjectDashboardScreen from './screens/ProjectDashboardScreen'
import ProjectIntelligenceScreen from './screens/ProjectIntelligenceScreen'
import ProjectWorkspaceScreen from './screens/ProjectWorkspaceScreen'
import RegisterScreen from './screens/RegisterScreen'
import SettingsScreen from './screens/SettingsScreen'

const SHELL_PATHS = [
  '/home',
  '/dashboard',
  '/documents',
  '/presentations',
  '/developers',
  '/credits',
  '/settings',
  '/project'
]

/** Screens stay mounted behind the guard so a reload restores the session. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useSession()
  if (loading) {
    return (
      <div className="boot-splash" aria-busy="true" aria-label="Loading INDRA HUB">
        <span className="spinner" aria-hidden="true" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function viewLabel(pathname: string): string {
  if (pathname.startsWith('/project')) {
    if (pathname.includes('/documents')) return 'Documents'
    if (pathname.includes('/presentations')) return 'Presentations'
    if (pathname.endsWith('/intelligence')) return 'Intelligence'
    return pathname.endsWith('/workspace') ? 'Workspace' : 'Project'
  }
  if (pathname.startsWith('/home')) return 'Home'
  if (pathname.startsWith('/dashboard')) return 'Projects'
  if (pathname === '/documents') return 'Documents'
  if (pathname === '/presentations') return 'Presentations'
  if (pathname.startsWith('/developers')) return 'Developers'
  if (pathname.startsWith('/credits')) return 'Tokens'
  if (pathname.startsWith('/settings')) return 'Settings'
  if (pathname.startsWith('/admin')) return 'Administration'
  if (pathname.startsWith('/register')) return 'Create account'
  return 'Authentication'
}

export default function App() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, signOut, enteredAt, acknowledgeEntry } = useSession()
  const { status, refresh: refreshStatus } = useAppStatus()
  const { theme, setTheme } = useTheme()
  const { offline } = useConnectivity()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const toast = useToast()
  const invitations = useInvitations()

  const signedIn = Boolean(user)
  const inShell = signedIn && SHELL_PATHS.some((path) => pathname.startsWith(path))
  /*
   * Maintenance closes the workspace, not the door. Signing in and registering
   * always work; what a session then finds is this screen. The administration
   * panel is exempt so maintenance can be lifted from inside it.
   */
  const maintenance = status.maintenanceMode
  const workspaceClosed = maintenance && signedIn && !pathname.startsWith('/admin')

  /*
   * Offline narrows the app to what it can actually do without a route out:
   * writing and building a deck. Anything else is redirected rather than shown
   * half-working — a dashboard whose cloud half is missing is worse than a
   * clear "this is what works right now".
   *
   * The offline workspace counts as offline even on a connected machine: while
   * it is open there is no account behind the session, so nothing that needs
   * one should be reachable.
   */
  const offlineMode = user?.mode === 'offline'
  const restricted = offline || offlineMode
  const blockedOffline = signedIn && restricted && !routeAllowedOffline(pathname)

  // The title bar names what is actually on screen, not the view underneath.
  const label = workspaceClosed ? 'Maintenance' : viewLabel(pathname)

  // A fresh session re-reads the switches before it renders anything: a user who
  // signs in during maintenance must land on the maintenance screen, not on a
  // dashboard whose data calls are about to be refused.
  useEffect(() => {
    if (signedIn) void refreshStatus()
  }, [signedIn, refreshStatus])

  /*
   * Invitations are read when a session opens, when the window comes back into
   * focus, and on a slow timer. There is no server pushing — an invitation is a
   * row in this installation's database — so a poll is the honest way to notice
   * one that arrived while the app sat in the background. Signing out empties
   * the list instead of leaving one person's invitations on the next screen.
   */
  useEffect(() => {
    if (!signedIn) {
      clearInvitations()
      return
    }
    void refreshInvitations()
    const onFocus = (): void => {
      void refreshInvitations()
    }
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => {
      void refreshInvitations()
    }, 30_000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [signedIn, user?.id])

  /* An invitation that appears after the first read is announced once. */
  const seenInvitations = useRef<Set<string>>(new Set())
  const primedInvitations = useRef(false)
  useEffect(() => {
    if (!signedIn) {
      seenInvitations.current = new Set()
      primedInvitations.current = false
      return
    }
    const known = seenInvitations.current
    const fresh = invitations.filter((invitation) => !known.has(invitation.id))
    for (const invitation of invitations) known.add(invitation.id)
    if (!primedInvitations.current) {
      primedInvitations.current = true
      return
    }
    if (fresh.length === 0) return
    if (fresh.length === 1) {
      const [invitation] = fresh
      toast.info(
        `${invitation.invitedByName} invited you to ${invitation.kind === 'team' ? 'their team' : 'a project'} — ${invitation.targetName}.`
      )
    } else {
      toast.info(`You have ${fresh.length} new invitations.`)
    }
  }, [invitations, signedIn, toast])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && inShell) {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inShell])

  // Administration has no visible entry point once it is configured. The
  // administrator opens it with Ctrl+Alt+A (Cmd+Alt+A on macOS); the gate
  // behind it still demands the administrator email and password, and
  // first-run setup stays reachable from the signed-out screen.
  useEffect(() => {
    function onAdminShortcut(event: KeyboardEvent) {
      if (!event.altKey || !(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() !== 'a') return
      event.preventDefault()
      navigate('/admin')
    }
    window.addEventListener('keydown', onAdminShortcut)
    return () => window.removeEventListener('keydown', onAdminShortcut)
  }, [navigate])

  const commands = useMemo<Command[]>(() => {
    // The same list the rail renders, so the palette cannot offer a screen the
    // rail has decided does not exist online.
    const icons: Record<string, ReactNode> = {
      '/home': <HomeIcon size={15} />,
      '/dashboard': <DashboardIcon size={15} />,
      '/documents': <FileIcon size={15} />,
      '/presentations': <PresentationIcon size={15} />,
      '/developers': <CodeIcon size={15} />,
      '/credits': <SparkIcon size={15} />,
      '/settings': <SettingsIcon size={15} />
    }
    const destinations = navDestinations(restricted).map((entry) => ({
      to: entry.to,
      label: `Go to ${entry.label}`,
      icon: icons[entry.to]
    }))

    return [
      ...destinations.map((destination) => ({
        id: destination.to,
        label: destination.label,
        hint: pathname === destination.to ? 'Current' : 'Navigate',
        keywords: destination.to,
        icon: destination.icon,
        run: () => navigate(destination.to)
      })),
      {
        id: 'theme',
        label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        hint: 'Appearance',
        keywords: 'theme dark light appearance',
        icon: theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />,
        run: () => setTheme(theme === 'dark' ? 'light' : 'dark')
      },
      {
        id: 'account',
        label: user ? `Signed in as @${user.username}` : 'Account',
        hint: 'Account',
        keywords: 'profile account',
        icon: <UserIcon size={15} />,
        run: () => navigate('/settings')
      },
      {
        id: 'sign-out',
        label: 'Sign out',
        hint: 'Account',
        keywords: 'logout sign out lock leave',
        icon: <SignOutIcon size={15} />,
        run: () => {
          void signOut().then(() => navigate('/login', { replace: true }))
        }
      }
    ]
  }, [navigate, pathname, restricted, setTheme, signOut, theme, user])

  /*
   * Signing in and registering both land here for four seconds. It sits above
   * the routes on purpose: the moment the session exists, /login and /register
   * redirect, and a loader rendered inside either screen would be unmounted
   * before it could finish.
   */
  if (enteredAt) {
    return (
      <OpeningScreen
        name={user?.displayName?.trim().split(/\s+/)[0]}
        detail={user?.mode === 'offline' ? 'Working offline' : 'Signed in'}
        onDone={acknowledgeEntry}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        label={label}
        showSearch={inShell && !workspaceClosed}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      <div className="min-h-0 flex-1">
        {!signedIn && offline && !pathname.startsWith('/admin') ? (
          /*
           * No account and no connection: the sign-in form would accept a
           * password and check it against a hash in this file, which proves
           * nothing. It is not shown. The offline workspace is.
           */
          <OfflineScreen />
        ) : blockedOffline ? (
          /* Offline: the two things that work, and nothing that does not. */
          <Navigate to="/documents" replace />
        ) : signedIn && !restricted && isLibraryPath(pathname) ? (
          /*
           * The library is the offline workspace. Online, documents and decks
           * live in their project, so an old link or a bookmark lands on the
           * project list rather than on a second, parallel way to find work.
           */
          <Navigate to="/dashboard" replace />
        ) : workspaceClosed ? (
          <MaintenanceScreen
            message={status.maintenanceMessage}
            onSignOut={() => {
              void signOut().then(() => navigate('/login', { replace: true }))
            }}
          />
        ) : (
        <Routes>
          <Route
            path="/login"
            element={signedIn ? <Navigate to="/home" replace /> : <LoginScreen />}
          />
          <Route
            path="/register"
            element={signedIn ? <Navigate to="/home" replace /> : <RegisterScreen />}
          />

          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/home" element={<HomeScreen />} />
            <Route path="/dashboard" element={<DashboardScreen />} />
            <Route path="/documents" element={<LibraryScreen kind="documents" />} />
            <Route path="/presentations" element={<LibraryScreen kind="presentations" />} />
            <Route path="/developers" element={<DevelopersScreen />} />
            <Route path="/credits" element={<CreditsScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />

            {/* Projects keep the shell so the team context is never lost. */}
            <Route path="/project/:projectId" element={<ProjectDashboardScreen />} />
            <Route
              path="/project/:projectId/intelligence"
              element={<ProjectIntelligenceScreen />}
            />
            <Route path="/project/:projectId/documents" element={<DocumentsScreen />} />
            <Route path="/project/:projectId/presentations" element={<PresentationsScreen />} />
          </Route>

          {/* Administration has its own identity and session, so it sits
              outside RequireAuth and the app shell entirely. */}
          <Route path="/admin" element={<AdminScreen />} />

          {/* Writing and slide editing are focus modes: full-bleed, own toolbar. */}
          <Route
            path="/project/:projectId/documents/:documentId"
            element={
              <RequireAuth>
                <DocumentEditorScreen />
              </RequireAuth>
            }
          />
          <Route
            path="/project/:projectId/presentations/:presentationId"
            element={
              <RequireAuth>
                <PresentationEditorScreen />
              </RequireAuth>
            }
          />
          {/* The workspace is a focused mode: full-bleed, its own header. */}
          <Route
            path="/project/:projectId/workspace"
            element={
              <RequireAuth>
                <ProjectWorkspaceScreen />
              </RequireAuth>
            }
          />

          <Route path="*" element={<Navigate to={signedIn ? '/home' : '/login'} replace />} />
        </Routes>
        )}
      </div>

      {inShell && !workspaceClosed && (
        <CommandPalette
          open={paletteOpen}
          commands={commands}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  )
}
