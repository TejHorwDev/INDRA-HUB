import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import AppShell from './components/AppShell'
import CommandPalette from './components/CommandPalette'
import type { Command } from './components/CommandPalette'
import TitleBar from './components/TitleBar'
import {
  CodeIcon,
  DashboardIcon,
  MoonIcon,
  SettingsIcon,
  SignOutIcon,
  SparkIcon,
  SunIcon,
  UserIcon
} from './components/icons'
import { useAppStatus } from './lib/appStatus'
import { useSession } from './lib/session'
import { useTheme } from './lib/theme'
import AdminScreen from './screens/AdminScreen'
import CreditsScreen from './screens/CreditsScreen'
import DashboardScreen from './screens/DashboardScreen'
import DevelopersScreen from './screens/DevelopersScreen'
import DocumentEditorScreen from './screens/DocumentEditorScreen'
import DocumentsScreen from './screens/DocumentsScreen'
import LoginScreen from './screens/LoginScreen'
import MaintenanceScreen from './screens/MaintenanceScreen'
import PresentationEditorScreen from './screens/PresentationEditorScreen'
import PresentationsScreen from './screens/PresentationsScreen'
import ProjectDashboardScreen from './screens/ProjectDashboardScreen'
import ProjectIntelligenceScreen from './screens/ProjectIntelligenceScreen'
import ProjectWorkspaceScreen from './screens/ProjectWorkspaceScreen'
import RegisterScreen from './screens/RegisterScreen'
import SettingsScreen from './screens/SettingsScreen'

const SHELL_PATHS = ['/dashboard', '/developers', '/credits', '/settings', '/project']

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
  if (pathname.startsWith('/dashboard')) return 'Projects'
  if (pathname.startsWith('/developers')) return 'Developers'
  if (pathname.startsWith('/credits')) return 'Credits'
  if (pathname.startsWith('/settings')) return 'Settings'
  if (pathname.startsWith('/admin')) return 'Administration'
  if (pathname.startsWith('/register')) return 'Create account'
  return 'Sign in'
}

export default function App() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, signOut } = useSession()
  const { status, refresh: refreshStatus } = useAppStatus()
  const { theme, setTheme } = useTheme()
  const [paletteOpen, setPaletteOpen] = useState(false)

  const signedIn = Boolean(user)
  const inShell = signedIn && SHELL_PATHS.some((path) => pathname.startsWith(path))
  /*
   * Maintenance closes the workspace, not the door. Signing in and registering
   * always work; what a session then finds is this screen. The administration
   * panel is exempt so maintenance can be lifted from inside it.
   */
  const maintenance = status.maintenanceMode
  const workspaceClosed = maintenance && signedIn && !pathname.startsWith('/admin')

  // The title bar names what is actually on screen, not the view underneath.
  const label = workspaceClosed ? 'Maintenance' : viewLabel(pathname)

  // A fresh session re-reads the switches before it renders anything: a user who
  // signs in during maintenance must land on the maintenance screen, not on a
  // dashboard whose data calls are about to be refused.
  useEffect(() => {
    if (signedIn) void refreshStatus()
  }, [signedIn, refreshStatus])

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
    const destinations = [
      { to: '/dashboard', label: 'Go to Projects', icon: <DashboardIcon size={15} /> },
      { to: '/developers', label: 'Go to Developers', icon: <CodeIcon size={15} /> },
      { to: '/credits', label: 'Go to Credits', icon: <SparkIcon size={15} /> },
      { to: '/settings', label: 'Go to Settings', icon: <SettingsIcon size={15} /> }
    ]

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
  }, [navigate, pathname, setTheme, signOut, theme, user])

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        label={label}
        showSearch={inShell && !workspaceClosed}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      <div className="min-h-0 flex-1">
        {workspaceClosed ? (
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
            element={signedIn ? <Navigate to="/dashboard" replace /> : <LoginScreen />}
          />
          <Route
            path="/register"
            element={signedIn ? <Navigate to="/dashboard" replace /> : <RegisterScreen />}
          />

          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/dashboard" element={<DashboardScreen />} />
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

          <Route path="*" element={<Navigate to={signedIn ? '/dashboard' : '/login'} replace />} />
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
