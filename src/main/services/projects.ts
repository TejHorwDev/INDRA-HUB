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
}

const PROJECT_COLUMNS = `
  p.id, p.name, p.description, p.owner_id, p.created_at, p.updated_at,
  u.display_name AS owner_name,
  u.username     AS owner_username,
  (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id) AS member_count,
  EXISTS(SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?) AS is_member
`

function roleOf(row: ProjectRow, viewerId: string): ProjectRole {
  return row.owner_id === viewerId ? 'owner' : 'member'
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
    role: roleOf(row, viewerId)
  }
}

function loadRow(projectId: string, viewerId: string): ProjectRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT ${PROJECT_COLUMNS}
         FROM projects p
         JOIN users u ON u.id = p.owner_id
        WHERE p.id = ?`
    )
    .get(viewerId, projectId) as ProjectRow | undefined
}

function readMembers(projectId: string): ProjectMember[] {
  const rows = getDatabase()
    .prepare(
      `SELECT m.user_id, m.joined_at, u.username, u.display_name
         FROM project_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.project_id = ?
        ORDER BY m.joined_at ASC`
    )
    .all(projectId) as Array<{
    user_id: string
    joined_at: string
    username: string
    display_name: string
  }>

  return rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    role: 'member',
    joinedAt: row.joined_at
  }))
}

function detail(row: ProjectRow, viewerId: string): ProjectDetail {
  return {
    ...toSummary(row, viewerId),
    owner: {
      id: row.owner_id,
      username: row.owner_username,
      displayName: row.owner_name
    },
    members: readMembers(row.id)
  }
}

/** Projects the viewer owns or belongs to. */
export function listProjects(viewer: SessionUser): ProjectSummary[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${PROJECT_COLUMNS}
         FROM projects p
         JOIN users u ON u.id = p.owner_id
        WHERE p.owner_id = ?
           OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?)
        ORDER BY p.updated_at DESC`
    )
    .all(viewer.id, viewer.id, viewer.id) as unknown as ProjectRow[]

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

export function addMember(
  viewer: SessionUser,
  projectId: string,
  userId: string
): ProjectDetail {
  const project = requireOwnedProject(viewer, projectId)
  const db = getDatabase()

  if (userId === project.owner_id) {
    throw errors.validation('The head developer is already on this project.', 'userId')
  }

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(userId)
  if (!target) throw errors.validation('No INDRA HUB account matches that person.', 'userId')

  const existing = db
    .prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(projectId, userId)
  if (existing) throw errors.duplicateMember()

  const now = new Date().toISOString()

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO project_members (project_id, user_id, role, joined_at)
       VALUES (?, ?, 'member', ?)`
    ).run(projectId, userId, now)
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, projectId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    // The trigger is the last line of defence if a service check is bypassed.
    if (error instanceof Error && error.message.includes('owner_cannot_be_member')) {
      throw errors.validation('The head developer cannot be added as a member.', 'userId')
    }
    throw error
  }

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
