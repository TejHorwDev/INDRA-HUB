/*
 * What the rail offers, as data.
 *
 * Documents and Presentations are the OFFLINE workspace: with no route out the
 * app is the writing tool, and those two screens are where the work is. Online
 * they do not appear at all — a project is the container, and its documents and
 * decks are opened from inside it. Two extra lists in the rail that answered a
 * question nobody asked were the wrong answer, twice.
 *
 * Kept as plain data, with no React in the file, so the simulations can assert
 * the rule instead of trusting a screenshot.
 */

export interface NavEntry {
  to: string
  label: string
}

export interface NavGroup {
  label: string
  items: NavEntry[]
}

const HOME: NavEntry = { to: '/home', label: 'Home' }
const PROJECTS: NavEntry = { to: '/dashboard', label: 'Projects' }
const DOCUMENTS: NavEntry = { to: '/documents', label: 'Documents' }
const PRESENTATIONS: NavEntry = { to: '/presentations', label: 'Presentations' }
const DEVELOPERS: NavEntry = { to: '/developers', label: 'Developers' }
const TOKENS: NavEntry = { to: '/credits', label: 'Tokens' }
const SETTINGS: NavEntry = { to: '/settings', label: 'Settings' }

/** Screens that exist only for the offline workspace. */
export const LIBRARY_PATHS = ['/documents', '/presentations'] as const

export function isLibraryPath(pathname: string): boolean {
  return LIBRARY_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

/**
 * Online: the workspace as a set of projects, with the library left out.
 * Offline: one group, writing first, and nothing that needs the network.
 */
export function navGroups(offline: boolean): NavGroup[] {
  if (offline) {
    return [{ label: 'Offline', items: [DOCUMENTS, PRESENTATIONS, PROJECTS, SETTINGS] }]
  }

  return [
    { label: 'Workspace', items: [HOME, PROJECTS, DEVELOPERS] },
    { label: 'Account', items: [TOKENS, SETTINGS] }
  ]
}

/** Every destination, for the command palette; the library only offline. */
export function navDestinations(offline: boolean): NavEntry[] {
  return navGroups(offline).flatMap((group) => group.items)
}
