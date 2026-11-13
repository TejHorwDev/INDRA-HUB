import { randomUUID } from 'node:crypto'
import type {
  CreateProjectInput,
  ProjectDetail,
  ProjectMember,
  ProjectRole,
  ProjectSummary,
  SessionUser
} from '@shared/types'
import { getDatabase } from '../db/database'
import { errors } from '../lib/errors'
import { validateProjectInput } from '../lib/validation'
import { inviteToProject, pendingInvitations } from './invitations'

interface ProjectRow {
  id: string
  name: string
  description: string
  owner_id: string
  created_at: string
  updated_at: string
  owner_name: string
  owner_username: string
  member_count: number
  is_member: number
  is_team_member: number
}

/*
 * Who can open a project.
 *
 * Three ways in, and only three:
 *   1. you own it;
 *   2. you accepted an invitation to it (a project_members row);
 *   3. you are on the head developer's team.
 *
 * The third one is the whole point of a team. A team is "the people I work
 * with"; making each new project a second, separate invitation would mean a
 * colleague who joined the group still could not open the work, which is what
 * the team was for. So a team is a standing yes for the projects its owner
 * starts, and leaving the team — or being removed from it — takes that back the
 * same moment. Anyone outside the team still needs an invitation, which is why
 * the two mechanisms live together rather than replacing each other.
 */
const TEAM_ACCESS = `EXISTS (
  SELECT 1 FROM teams t
    JOIN team_members tm ON tm.team_id = t.id
   WHERE t.owner_id = p.owner_id AND tm.user_id = ?
)`

/** Everyone with access, owner aside: invited people and the owner's team, once each. */
const MEMBER_COUNT = `(
  SELECT COUNT(*) FROM (
    SELECT m.user_id FROM project_members m WHERE m.project_id = p.id
    UNION
    SELECT tm.user_id FROM team_members tm
      JOIN teams t ON t.id = tm.team_id
     WHERE t.owner_id = p.owner_id
  )
)`

const PROJECT_COLUMNS = `
  p.id, p.name, p.description, p.owner_id, p.created_at, p.updated_at,
  u.display_name AS owner_name,
  u.username     AS owner_username,
  ${MEMBER_COUNT} AS member_count,
  CASE WHEN ${TEAM_ACCESS} THEN 1
       WHEN EXISTS(SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?) THEN 1
       ELSE 0 END AS is_member,
  CASE WHEN ${TEAM_ACCESS} THEN 1 ELSE 0 END AS is_team_member
`

function roleOf(row: ProjectRow, viewerId: string): ProjectRole {
  return row.owner_id === viewerId ? 'owner' : 'member'
}

function viaOf(row: ProjectRow, viewerId: string): 'owner' | 'invite' | 'team' {
  if (row.owner_id === viewerId) return 'owner'
  return Number(row.is_team_member) === 1 ? 'team' : 'invite'
}

function toSummary(row: ProjectRow, viewerId: string): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memberCount: Number(row.member_count ?? 0),
    role: roleOf(row, viewerId),
    via: viaOf(row, viewerId)
  }
}

function loadRow(projectId: string, viewerId: string): ProjectRow | undefined {
  // Three placeholders inside the column list — the team check appears twice,
  // and the explicit-membership check once — then the project id.
  return getDatabase()
    .prepare(
      `SELECT ${PROJECT_COLUMNS}
         FROM projects p
         JOIN users u ON u.id = p.owner_id
        WHERE p.id = ?`
    )
    .get(viewerId, viewerId, viewerId, projectId) as ProjectRow | undefined
}

/**
 * The people who can work here, with how they got in. Invited people first, in
 * the order they joined; the team after them, because being on the team is a
 * standing relationship rather than an arrival.
 */
function readMembers(projectId: string, ownerId: string): ProjectMember[] {
  const rows = getDatabase()
    .prepare(
      `SELECT m.user_id, m.joined_at, u.username, u.display_name, u.avatar, 'invite' AS via
         FROM project_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.project_id = ?
        UNION ALL
       SELECT tm.user_id, tm.joined_at, u.username, u.display_name, u.avatar, 'team' AS via
         FROM team_members tm
         JOIN teams t ON t.id = tm.team_id
         JOIN users u ON u.id = tm.user_id
        WHERE t.owner_id = ?
          AND tm.user_id NOT IN (SELECT user_id FROM project_members WHERE project_id = ?)
        ORDER BY via ASC, joined_at ASC`
    )
    .all(projectId, ownerId, projectId) as Array<{
    user_id: string
    joined_at: string
    username: string
    display_name: string
    avatar: string | null
    via: 'invite' | 'team'
  }>

  return rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar,
    role: 'member',
    via: row.via,
    joinedAt: row.joined_at
  }))
}

function teamOf(ownerId: string): ProjectDetail['team'] {
  const row = getDatabase()
    .prepare(
      `SELECT t.id, t.name,
              (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS members
         FROM teams t
        WHERE t.owner_id = ?`
    )
    .get(ownerId) as { id: string; name: string; members: number } | undefined
  if (!row) return null
  return { id: row.id, name: row.name, memberCount: Number(row.members) }
}

function detail(row: ProjectRow, viewerId: string): ProjectDetail {
  return {
    ...toSummary(row, viewerId),
    owner: {
      id: row.owner_id,
      username: row.owner_username,
      displayName: row.owner_name
    },
    members: readMembers(row.id, row.owner_id),
    // The head developer's team, so the screen can say out loud who else can
    // already open this — an access rule that is invisible is a surprise later.
    team: teamOf(row.owner_id),
    // Only the head developer is shown who has been asked and not answered.
    invitations: row.owner_id === viewerId ? pendingInvitations('project', row.id) : []
  }
}

/** Projects the viewer owns, was invited to, or can reach through their team. */
export function listProjects(viewer: SessionUser): ProjectSummary[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${PROJECT_COLUMNS}
         FROM projects p
         JOIN users u ON u.id = p.owner_id
        WHERE p.owner_id = ?
           OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?)
           OR ${TEAM_ACCESS}
        ORDER BY p.updated_at DESC`
    )
    .all(viewer.id, viewer.id, viewer.id, viewer.id, viewer.id, viewer.id) as unknown as ProjectRow[]

  return rows.map((row) => toSummary(row, viewer.id))
}

/** Creates an empty project; the creator is the head developer by definition. */
export function createProject(viewer: SessionUser, input: CreateProjectInput): ProjectDetail {
  const { name, description } = validateProjectInput(input ?? {})
  const db = getDatabase()
  const id = randomUUID()
  const now = new Date().toISOString()

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO projects (id, name, description, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, name, description, viewer.id, now, now)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const row = loadRow(id, viewer.id)
  if (!row) throw new Error('project missing after insert')
  return detail(row, viewer.id)
}

/**
 * Throws NOT_FOUND for anyone who is not the owner or an active member, so a
 * guessed project id reveals nothing about whether the project exists.
 */
export function getProject(viewer: SessionUser, projectId: string): ProjectDetail {
  const row = typeof projectId === 'string' ? loadRow(projectId, viewer.id) : undefined
  if (!row) throw errors.notFound()
  const isOwner = row.owner_id === viewer.id
  if (!isOwner && Number(row.is_member) !== 1) throw errors.notFound()
  return detail(row, viewer.id)
}

function requireOwnedProject(viewer: SessionUser, projectId: string): ProjectRow {
  const row = loadRow(projectId, viewer.id)
  if (!row) throw errors.notFound()
  if (row.owner_id !== viewer.id) {
    // Members get a clear refusal; strangers get nothing at all.
    if (Number(row.is_member) === 1) throw errors.forbidden()
    throw errors.notFound()
  }
  return row
}

/**
 * Shared authorization for every project resource (documents, presentations,
 * intelligence). Non-members get NOT_FOUND so ids can't be probed.
 */
export function projectAccess(viewer: SessionUser, projectId: string): ProjectRole {
  const row = loadRow(projectId, viewer.id)
  if (!row) throw errors.notFound()
  const isOwner = row.owner_id === viewer.id
  if (!isOwner && Number(row.is_member) !== 1) throw errors.notFound()
  return isOwner ? 'owner' : 'member'
}

/** Used by team search: only the head developer may look for candidates. */
export function assertCanManageTeam(viewer: SessionUser, projectId: string): void {
  requireOwnedProject(viewer, projectId)
}

/**
 * Inviting somebody onto a project.
 *
 * The owner chooses a person; that person is asked, and joins only by
 * accepting. Nothing of the project is reachable until they do — access is
 * derived from project_members, which acceptance is the only thing to write.
 */
export function inviteMember(
  viewer: SessionUser,
  projectId: string,
  ref: string
): ProjectDetail {
  const project = requireOwnedProject(viewer, projectId)
  const value = String(ref ?? '').trim()

  if (!value) throw errors.validation('Choose someone to invite.', 'userId')
  if (value === project.owner_id) {
    throw errors.validation('The head developer is already on this project.', 'userId')
  }

  const existing = getDatabase()
    .prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(projectId, value)
  if (existing) throw errors.duplicateMember()

  inviteToProject(viewer, projectId, value)

  const row = loadRow(projectId, viewer.id)
  if (!row) throw errors.notFound()
  return detail(row, viewer.id)
}

export function removeMember(
  viewer: SessionUser,
  projectId: string,
  userId: string
): ProjectDetail {
  const project = requireOwnedProject(viewer, projectId)
  const db = getDatabase()

  if (userId === project.owner_id) {
    throw errors.forbidden('Ownership cannot be removed or transferred.')
  }

  // Team access is not a row on this project, so it cannot be removed here.
  // Saying that plainly is kinder than "not on this project", which would be
  // true of the table and false of what the owner can see.
  const standing = db
    .prepare(
      `SELECT 1 FROM projects p
         JOIN teams t ON t.owner_id = p.owner_id
         JOIN team_members tm ON tm.team_id = t.id
        WHERE p.id = ? AND tm.user_id = ?`
    )
    .get(projectId, userId)
  if (standing) {
    throw errors.forbidden(
      'They are on your team, so they can open every project you own. Remove them from the team instead.'
    )
  }

  const existing = db
    .prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(projectId, userId)
  if (!existing) throw errors.notFound('That person is no longer on this project.')

  const now = new Date().toISOString()

  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(
      projectId,
      userId
    )
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, projectId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const row = loadRow(projectId, viewer.id)
  if (!row) throw errors.notFound()
  return detail(row, viewer.id)
}
