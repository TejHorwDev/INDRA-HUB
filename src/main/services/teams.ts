import { randomUUID } from 'node:crypto'
import type { SessionUser, TeamDetail, TeamOverview, UserSummary } from '@shared/types'
import { getDatabase } from '../db/database'
import { errors } from '../lib/errors'

/*
 * Teams: the small group of people who work together inside one installation.
 *
 * One team per person — enforced by a unique index, not by the UI — and a
 * roster of colleagues they have added. The owner is the team: they are never
 * a member row (a trigger rejects that), they alone may rename it, change the
 * roster or delete it, and everyone on the roster can see who else is on it.
 *
 * This is deliberately a separate idea from project membership. A project
 * belongs to one person and may borrow a few individuals; a team is the
 * standing group. They will meet later — "add my whole team to this project" —
 * but nothing here depends on that happening.
 */

const MAX_NAME = 60
const MAX_MEMBERS = 50

interface TeamRow {
  id: string
  name: string
  owner_id: string
  created_at: string
  updated_at: string
}

interface MemberRow {
  id: string
  username: string
  display_name: string
  joined_at: string
}

interface PersonRow {
  id: string
  username: string
  display_name: string
}

function now(): string {
  return new Date().toISOString()
}

function cleanName(input: unknown): string {
  const name = String(input ?? '').trim().replace(/\s+/g, ' ')
  if (!name) throw errors.validation('Give the team a name.', 'name')
  if (name.length > MAX_NAME) {
    throw errors.validation(`Keep the name under ${MAX_NAME} characters.`, 'name')
  }
  return name
}

function ownedTeam(ownerId: string): TeamRow | null {
  return (
    (getDatabase().prepare('SELECT * FROM teams WHERE owner_id = ?').get(ownerId) as
      | TeamRow
      | undefined) ?? null
  )
}

function teamById(id: string): TeamRow | null {
  return (
    (getDatabase().prepare('SELECT * FROM teams WHERE id = ?').get(id) as TeamRow | undefined) ??
    null
  )
}

function memberOfTeam(teamId: string, userId: string): boolean {
  return Boolean(
    getDatabase()
      .prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?')
      .get(teamId, userId)
  )
}

/** The team this person owns, or they must be on the roster of the one given. */
function requireOwned(viewer: SessionUser): TeamRow {
  const team = ownedTeam(viewer.id)
  if (!team) throw errors.validation('You do not have a team yet.', 'team')
  return team
}

function detail(row: TeamRow, viewerId: string): TeamDetail {
  const db = getDatabase()
  const owner = db
    .prepare('SELECT id, username, display_name FROM users WHERE id = ?')
    .get(row.owner_id) as PersonRow | undefined

  const members = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, m.joined_at
         FROM team_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.team_id = ?
        ORDER BY u.display_name COLLATE NOCASE ASC, u.username COLLATE NOCASE ASC`
    )
    .all(row.id) as unknown as MemberRow[]

  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    ownerName: owner?.display_name ?? 'Unknown',
    createdAt: row.created_at,
    role: row.owner_id === viewerId ? 'owner' : 'member',
    memberCount: members.length + 1,
    members: [
      {
        id: owner?.id ?? row.owner_id,
        username: owner?.username ?? 'unknown',
        displayName: owner?.display_name ?? 'Unknown',
        role: 'owner',
        joinedAt: row.created_at
      },
      ...members.map((member) => ({
        id: member.id,
        username: member.username,
        displayName: member.display_name,
        role: 'member' as const,
        joinedAt: member.joined_at
      }))
    ]
  }
}

/** Everything the home screen shows: the team you own, and any you belong to. */
export function teamOverview(viewer: SessionUser): TeamOverview {
  const db = getDatabase()
  const owned = ownedTeam(viewer.id)

  const others = db
    .prepare(
      `SELECT t.* FROM teams t
         JOIN team_members m ON m.team_id = t.id
        WHERE m.user_id = ?
        ORDER BY t.created_at ASC`
    )
    .all(viewer.id) as unknown as TeamRow[]

  return {
    owned: owned ? detail(owned, viewer.id) : null,
    memberOf: others.map((row) => detail(row, viewer.id))
  }
}

export function createTeam(viewer: SessionUser, input?: { name?: string }): TeamDetail {
  if (ownedTeam(viewer.id)) {
    throw errors.validation('You already have a team. Rename it instead.', 'name')
  }

  const name = String(input?.name ?? '').trim()
    ? cleanName(input?.name)
    : `${viewer.displayName.split(' ')[0] || viewer.username}'s team`

  const id = randomUUID()
  const stamp = now()
  getDatabase()
    .prepare('INSERT INTO teams (id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, viewer.id, stamp, stamp)

  return detail(teamById(id) as TeamRow, viewer.id)
}

export function renameTeam(viewer: SessionUser, input: { name?: string }): TeamDetail {
  const team = requireOwned(viewer)
  const name = cleanName(input?.name)
  getDatabase()
    .prepare('UPDATE teams SET name = ?, updated_at = ? WHERE id = ?')
    .run(name, now(), team.id)
  return detail(teamById(team.id) as TeamRow, viewer.id)
}

export function deleteTeam(viewer: SessionUser): TeamOverview {
  const team = requireOwned(viewer)
  getDatabase().prepare('DELETE FROM teams WHERE id = ?').run(team.id)
  return teamOverview(viewer)
}

export function addTeamMember(viewer: SessionUser, userId: unknown): TeamDetail {
  const team = requireOwned(viewer)
  const id = String(userId ?? '')
  if (!id) throw errors.validation('Choose someone to add.', 'userId')
  if (id === viewer.id) throw errors.validation('You are already on your own team.', 'userId')

  const person = getDatabase()
    .prepare('SELECT id, suspended_at FROM users WHERE id = ?')
    .get(id) as { id: string; suspended_at: string | null } | undefined

  if (!person) throw errors.notFound('That account no longer exists.')
  if (person.suspended_at) {
    throw errors.validation('That account is suspended, so it cannot join a team.', 'userId')
  }
  if (memberOfTeam(team.id, id)) {
    throw errors.validation('That person is already on the team.', 'userId')
  }

  const count = getDatabase()
    .prepare('SELECT COUNT(*) AS total FROM team_members WHERE team_id = ?')
    .get(team.id) as { total: number }
  if (Number(count.total) >= MAX_MEMBERS) {
    throw errors.validation(`A team holds ${MAX_MEMBERS} people.`, 'userId')
  }

  getDatabase()
    .prepare('INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
    .run(team.id, id, 'member', now())

  return detail(teamById(team.id) as TeamRow, viewer.id)
}

export function removeTeamMember(viewer: SessionUser, userId: unknown): TeamDetail {
  const team = requireOwned(viewer)
  const id = String(userId ?? '')

  if (!memberOfTeam(team.id, id)) {
    throw errors.notFound('That person is not on the team.')
  }

  getDatabase().prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(team.id, id)
  return detail(teamById(team.id) as TeamRow, viewer.id)
}

/**
 * Accounts that could join this team. Registered accounts only, and the people
 * already on the roster are filtered out here so the UI cannot offer a choice
 * that would fail.
 */
export function searchTeamCandidates(viewer: SessionUser, query: unknown): UserSummary[] {
  const team = ownedTeam(viewer.id)
  const search = String(query ?? '').trim()
  if (search.length < 2) return []

  const like = `%${search.replace(/[%_]/g, '')}%`
  const rows = getDatabase()
    .prepare(
      `SELECT id, username, display_name
         FROM users
        WHERE (username LIKE ? COLLATE NOCASE OR display_name LIKE ? COLLATE NOCASE)
          AND suspended_at IS NULL
          AND id <> ?
          AND id NOT IN (SELECT user_id FROM team_members WHERE team_id = ?)
        ORDER BY username COLLATE NOCASE ASC
        LIMIT 8`
    )
    .all(like, like, viewer.id, team?.id ?? '') as unknown as PersonRow[]

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name
  }))
}
