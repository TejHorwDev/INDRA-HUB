import { randomUUID } from 'node:crypto'
import type { InvitationAnswer, InvitationSummary, SessionUser } from '@shared/types'
import { getDatabase } from '../db/database'
import { errors } from '../lib/errors'

/*
 * Joining something is a question, not a write.
 *
 * "Add member" used to insert a membership row, and the other person found
 * themselves on a team — or inside somebody's project — with no say in it. That
 * is wrong in both directions: it hands a stranger access to work they never
 * agreed to look after, and it gives the person added no way to notice.
 *
 * So the owner asks. An invitation is a row addressed to one account, for one
 * team or one project, with a status. The person it names sees it on Home and
 * answers. Only acceptance writes a membership; declining, revoking and
 * cancelling are recorded rather than deleted, so the owner can see that a
 * question went unanswered instead of guessing.
 *
 * Every rule lives here rather than in the screens: who may ask, who may
 * answer, who may take a question back, and what happens when two of those race.
 * The UI only renders what this file allows.
 */

/** Nobody can be asked so many things that the list becomes noise. */
const MAX_PENDING_PER_TARGET = 50
/** Owner included: the same ceiling teams.ts enforces. */
export const TEAM_MEMBER_LIMIT = 50

export type InvitationKind = 'team' | 'project'

interface InvitationRow {
  id: string
  kind: InvitationKind
  team_id: string | null
  project_id: string | null
  user_id: string
  invited_by: string
  created_at: string
  status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'cancelled'
}

interface AccountRow {
  id: string
  username: string
  display_name: string
  email: string
}

function now(): string {
  return new Date().toISOString()
}

function columnOf(kind: InvitationKind): 'team_id' | 'project_id' {
  return kind === 'team' ? 'team_id' : 'project_id'
}

function targetNameOf(kind: InvitationKind, targetId: string | null): string | null {
  if (!targetId) return null
  const table = kind === 'team' ? 'teams' : 'projects'
  const row = getDatabase().prepare(`SELECT name FROM ${table} WHERE id = ?`).get(targetId) as
    | { name: string }
    | undefined
  return row?.name ?? null
}

function summaryOf(row: InvitationRow): InvitationSummary {
  const db = getDatabase()
  const person = db
    .prepare('SELECT id, username, display_name, email FROM users WHERE id = ?')
    .get(row.user_id) as AccountRow | undefined
  const inviter = db
    .prepare('SELECT display_name FROM users WHERE id = ?')
    .get(row.invited_by) as { display_name: string } | undefined

  const targetId = row.team_id ?? row.project_id ?? ''

  return {
    id: row.id,
    kind: row.kind,
    targetId,
    targetName: targetNameOf(row.kind, targetId) ?? 'Something that no longer exists',
    personId: person?.id ?? row.user_id,
    displayName: person?.display_name ?? 'Unknown',
    email: person?.email ?? '',
    invitedByName: inviter?.display_name ?? 'Somebody',
    createdAt: row.created_at
  }
}

function rowsFor(kind: InvitationKind, targetId: string): InvitationRow[] {
  return getDatabase()
    .prepare(
      `SELECT * FROM invitations
        WHERE kind = ? AND ${columnOf(kind)} = ? AND status = 'pending'
        ORDER BY created_at ASC`
    )
    .all(kind, targetId) as unknown as InvitationRow[]
}

/** Who has been asked and not answered — what the owner's roster shows. */
export function pendingInvitations(
  kind: InvitationKind,
  targetId: string
): InvitationSummary[] {
  return rowsFor(kind, targetId).map(summaryOf)
}

/** Everything waiting for this account's answer, newest first. */
export function myInvitations(viewer: SessionUser): InvitationSummary[] {
  if (viewer.mode === 'offline') return []
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM invitations
        WHERE user_id = ? AND status = 'pending'
        ORDER BY created_at DESC`
    )
    .all(viewer.id) as unknown as InvitationRow[]
  return rows.map(summaryOf)
}

/**
 * The person being asked, found either by the account id the search already
 * returned or by the address itself. Anything else is "no such account" — this
 * is the only place a stranger's identity is resolved, so it is the only place
 * that needs to.
 */
function resolveAccount(ref: string): AccountRow {
  const db = getDatabase()
  const value = String(ref ?? '').trim()
  if (!value) throw errors.validation('Choose someone to invite.', 'query')

  const row = value.includes('@')
    ? (db
        .prepare(
          'SELECT id, username, display_name, email, suspended_at FROM users WHERE email = ? COLLATE NOCASE'
        )
        .get(value) as (AccountRow & { suspended_at: string | null }) | undefined)
    : (db
        .prepare(
          'SELECT id, username, display_name, email, suspended_at FROM users WHERE id = ?'
        )
        .get(value) as (AccountRow & { suspended_at: string | null }) | undefined)

  if (!row) {
    throw errors.notFound(
      value.includes('@') ? 'No account uses that email address.' : 'That account no longer exists.'
    )
  }
  if (row.suspended_at) {
    throw errors.validation('That account is suspended, so it cannot join.', 'query')
  }
  return row
}

function alreadyInvited(kind: InvitationKind, targetId: string, userId: string): boolean {
  return Boolean(
    getDatabase()
      .prepare(
        `SELECT 1 FROM invitations
          WHERE kind = ? AND ${columnOf(kind)} = ? AND user_id = ? AND status = 'pending'`
      )
      .get(kind, targetId, userId)
  )
}

/**
 * Ask one account to join one thing. The caller has already checked that the
 * viewer owns it and that the person is not already a member; this function
 * refuses the rest: yourself, a suspended account, a duplicate question, and a
 * list of questions long enough to be noise.
 */
function ask(
  kind: InvitationKind,
  targetId: string,
  viewer: SessionUser,
  ref: string
): InvitationSummary {
  const account = resolveAccount(ref)

  if (account.id === viewer.id) {
    throw errors.validation(
      kind === 'team' ? 'You are already on your own team.' : 'You are already on this project.',
      'query'
    )
  }

  // Somebody who is already in gets no question, however they were reached —
  // by id from the search, or by an address typed straight into the box.
  const member =
    kind === 'team'
      ? getDatabase()
          .prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?')
          .get(targetId, account.id)
      : getDatabase()
          .prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?')
          .get(targetId, account.id)

  if (member) {
    throw errors.validation(
      kind === 'team' ? 'That person is already on the team.' : 'That person is already on this project.',
      'query'
    )
  }

  if (alreadyInvited(kind, targetId, account.id)) {
    throw errors.conflict('They have already been invited. Waiting for an answer.')
  }

  const pending = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS total FROM invitations
        WHERE kind = ? AND ${columnOf(kind)} = ? AND status = 'pending'`
    )
    .get(kind, targetId) as { total: number }
  if (Number(pending.total) >= MAX_PENDING_PER_TARGET) {
    throw errors.validation(
      'That is already a long list of invitations. Wait for some answers.',
      'query'
    )
  }

  const id = randomUUID()
  getDatabase()
    .prepare(
      `INSERT INTO invitations (id, kind, team_id, project_id, user_id, invited_by, created_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(
      id,
      kind,
      kind === 'team' ? targetId : null,
      kind === 'project' ? targetId : null,
      account.id,
      viewer.id,
      now()
    )

  const row = getDatabase().prepare('SELECT * FROM invitations WHERE id = ?').get(id) as
    | InvitationRow
    | undefined
  if (!row) throw new Error('invitation vanished after insert')
  return summaryOf(row)
}

/** Ask somebody to join the team this account owns. */
export function inviteToTeam(viewer: SessionUser, ref: string): InvitationSummary {
  const team = getDatabase()
    .prepare('SELECT id FROM teams WHERE owner_id = ?')
    .get(viewer.id) as { id: string } | undefined
  if (!team) throw errors.validation('You do not have a team yet.', 'team')

  return ask('team', team.id, viewer, ref)
}

/** The same question for a project. Only its head developer may ask it. */
export function inviteToProject(
  viewer: SessionUser,
  projectId: string,
  ref: string
): InvitationSummary {
  const project = getDatabase()
    .prepare('SELECT id, owner_id FROM projects WHERE id = ?')
    .get(projectId) as { id: string; owner_id: string } | undefined
  if (!project) throw errors.notFound()
  if (project.owner_id !== viewer.id) {
    throw errors.forbidden('Only the head developer can invite people to this project.')
  }

  return ask('project', project.id, viewer, ref)
}

/**
 * Answering.
 *
 * Only the person named may answer, and only while the invitation is pending.
 * Acceptance re-checks what the invitation assumed: the account still exists
 * and is not suspended, the team or project still exists, and the roster has
 * room. Declining writes no membership — it only records the answer.
 */
export function respond(
  viewer: SessionUser,
  invitationId: string,
  accept: boolean
): InvitationAnswer {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM invitations WHERE id = ?').get(invitationId) as
    | InvitationRow
    | undefined
  if (!row) throw errors.notFound('That invitation no longer exists.')
  if (row.user_id !== viewer.id) {
    throw errors.forbidden('That invitation is not addressed to you.')
  }
  if (row.status !== 'pending') {
    throw errors.conflict('That invitation has already been answered.')
  }

  const targetId = row.team_id ?? row.project_id ?? ''
  const targetName = targetNameOf(row.kind, targetId)

  if (!targetName) {
    // Whatever it was for was deleted while the question sat unanswered.
    db.prepare("UPDATE invitations SET status = 'cancelled', responded_at = ? WHERE id = ?").run(
      now(),
      row.id
    )
    throw errors.notFound('What you were invited to no longer exists.')
  }

  if (!accept) {
    db.prepare("UPDATE invitations SET status = 'declined', responded_at = ? WHERE id = ?").run(
      now(),
      row.id
    )
    return { kind: row.kind, targetId, targetName, accepted: false }
  }

  const suspended = db.prepare('SELECT suspended_at FROM users WHERE id = ?').get(viewer.id) as
    | { suspended_at: string | null }
    | undefined
  if (suspended?.suspended_at) {
    throw errors.validation('This account is suspended and cannot join.')
  }

  db.exec('BEGIN')
  try {
    if (row.kind === 'team') {
      const count = db
        .prepare('SELECT COUNT(*) AS total FROM team_members WHERE team_id = ?')
        .get(targetId) as { total: number }
      // The owner counts toward the limit, and can never be a member row.
      if (Number(count.total) + 1 >= TEAM_MEMBER_LIMIT) {
        throw errors.validation('That team is full.')
      }
      db.prepare(
        'INSERT OR IGNORE INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
      ).run(targetId, viewer.id, 'member', now())
    } else {
      db.prepare(
        `INSERT INTO project_members (project_id, user_id, role, joined_at)
         VALUES (?, ?, 'member', ?)
         ON CONFLICT(project_id, user_id) DO NOTHING`
      ).run(targetId, viewer.id, now())
      db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), targetId)
    }

    db.prepare("UPDATE invitations SET status = 'accepted', responded_at = ? WHERE id = ?").run(
      now(),
      row.id
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return { kind: row.kind, targetId, targetName, accepted: true }
}

/** Taking the question back. Only the owner of what was offered may do this. */
export function revoke(viewer: SessionUser, invitationId: string): void {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM invitations WHERE id = ?').get(invitationId) as
    | InvitationRow
    | undefined
  if (!row) throw errors.notFound('That invitation no longer exists.')
  if (row.status !== 'pending') {
    throw errors.conflict('That invitation has already been answered.')
  }

  const ownerId =
    row.kind === 'team'
      ? ((db.prepare('SELECT owner_id FROM teams WHERE id = ?').get(row.team_id) as
          | { owner_id: string }
          | undefined)?.owner_id ?? '')
      : ((db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(row.project_id) as
          | { owner_id: string }
          | undefined)?.owner_id ?? '')

  if (ownerId !== viewer.id) {
    throw errors.forbidden('Only the owner can take an invitation back.')
  }

  db.prepare("UPDATE invitations SET status = 'revoked', responded_at = ? WHERE id = ?").run(
    now(),
    row.id
  )
}
