import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { InvitationSummary, TeamDetail, TeamOverview } from '@shared/types'
import AddTeamMemberDialog from '../components/AddTeamMemberDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import EmptyState from '../components/EmptyState'
import Page from '../components/Page'
import TeamNameDialog from '../components/TeamNameDialog'
import { useToast } from '../components/ToastProvider'
import { FolderIcon, UsersIcon, XIcon } from '../components/icons'
import { api, errorMessage } from '../lib/api'
import {
  acceptInvitation,
  cancelInvitation,
  declineInvitation,
  refreshInvitations,
  useInvitations
} from '../lib/invitations'
import { initialsOf, toneOf } from '../lib/format'
import { useSession } from '../lib/session'

/**
 * Home: who you are, and who you work with.
 *
 * Two things, side by side, and nothing else. The profile is the account the
 * app is signed in as; the team is the standing group this installation knows
 * about, with the roster, the one action that matters (invite someone) and the
 * removal that a roster needs. Everything else the app can do has its own
 * place already — a home screen that repeats it is just a menu with a hero.
 *
 * Invitations sit above both, and only while one is waiting. Being asked to
 * join something is the one thing on Home that has a deadline in spirit: an
 * unanswered question blocks the person who asked. So it is answered here, in
 * place, without a trip to another screen.
 */
function memberSince(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export default function HomeScreen() {
  const { user } = useSession()
  const toast = useToast()

  const [overview, setOverview] = useState<TeamOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nameDialog, setNameDialog] = useState<'create' | 'rename' | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [answeringId, setAnsweringId] = useState<string | null>(null)
  const invitations = useInvitations()

  const load = useCallback(async () => {
    try {
      setOverview(await api.team.read())
      setError(null)
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const team = overview?.owned ?? null
  const memberOf = overview?.memberOf ?? []

  function onTeamSaved(next: TeamDetail): void {
    const owner = nameDialog === 'create'
    setNameDialog(null)
    setOverview((current) => ({ owned: next, memberOf: current?.memberOf ?? [] }))
    toast.success(owner ? 'Team created.' : 'Team renamed.')
  }

  async function removeMember(member: TeamDetail['members'][number]): Promise<void> {
    try {
      const next = await api.team.removeMember(member.id)
      setOverview((current) => ({ owned: next, memberOf: current?.memberOf ?? [] }))
      toast.success(`${member.displayName} removed from the team.`)
    } catch (failure) {
      toast.error(errorMessage(failure))
    }
  }

  async function answer(invitation: InvitationSummary, accept: boolean): Promise<void> {
    if (answeringId) return
    setAnsweringId(invitation.id)
    try {
      const result = accept
        ? await acceptInvitation(invitation.id)
        : await declineInvitation(invitation.id)
      toast.success(
        result.accepted
          ? `You joined ${result.targetName}.`
          : `You declined the invitation to ${result.targetName}.`
      )
      // Accepting can add a team to "Member of", or a project to the list.
      if (result.accepted) await load()
    } catch (failure) {
      toast.error(errorMessage(failure))
    } finally {
      setAnsweringId(null)
    }
  }

  async function cancelInvite(invitation: InvitationSummary): Promise<void> {
    try {
      await cancelInvitation(invitation.id)
      setOverview(await api.team.read())
      toast.success(`Invitation to ${invitation.displayName} cancelled.`)
    } catch (failure) {
      toast.error(errorMessage(failure))
    }
  }

  async function deleteTeam(): Promise<void> {
    try {
      setOverview(await api.team.remove())
      setConfirmDelete(false)
      toast.success('Team deleted.')
    } catch (failure) {
      toast.error(errorMessage(failure))
    }
  }

  return (
    <Page title="Home">
      {invitations.length > 0 && (
        <section className="home-invites" aria-labelledby="home-invites-title">
          <div className="home-section-head">
            <h2 id="home-invites-title" className="home-section-title">
              Invitations
            </h2>
            <span className="home-count">
              {invitations.length} waiting for you
            </span>
          </div>

          <ul className="invite-list">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="invite-card">
                <span className="invite-mark" aria-hidden="true">
                  {invitation.kind === 'team' ? <UsersIcon size={16} /> : <FolderIcon size={16} />}
                </span>

                <span className="invite-text">
                  <span className="invite-title">
                    {invitation.targetName}
                    <span className="badge">{invitation.kind === 'team' ? 'Team' : 'Project'}</span>
                  </span>
                  <span className="invite-sub">
                    {invitation.invitedByName} invited you to join
                    {invitation.kind === 'project' ? ' this project' : ' their team'}.
                  </span>
                </span>

                <span className="invite-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm w-auto"
                    onClick={() => void answer(invitation, true)}
                    disabled={answeringId !== null}
                  >
                    {answeringId === invitation.id ? <span className="spinner" aria-hidden="true" /> : null}
                    Accept
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm w-auto"
                    onClick={() => void answer(invitation, false)}
                    disabled={answeringId !== null}
                  >
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="home">
        <section className="home-profile">
          <span className="avatar avatar--lg" style={{ '--tone': toneOf(user?.id ?? '') } as CSSProperties}>
            {initialsOf(user?.displayName ?? '')}
          </span>

          <div className="home-profile-text">
            <h2 className="home-name">{user?.displayName}</h2>
            <p className="home-handle">@{user?.username}</p>
            <p className="home-email">{user?.email}</p>
          </div>

          <div className="home-profile-actions">
            <span className="home-since">
              {user ? `Since ${memberSince(user.createdAt)}` : ''}
            </span>
            <Link to="/settings" className="link home-link">
              Account settings
            </Link>
          </div>
        </section>

        <section className="home-team" aria-labelledby="home-team-title">
          <div className="home-section-head">
            <h2 id="home-team-title" className="home-section-title">
              Team
            </h2>
            {team && (
              <span className="home-count">
                {team.memberCount} {team.memberCount === 1 ? 'member' : 'members'}
                {team.invitations.length > 0
                  ? ` · ${team.invitations.length} invited`
                  : ''}
              </span>
            )}
            {team && (
              <div className="home-section-actions">
                <button type="button" className="link-btn" onClick={() => setNameDialog('rename')}>
                  Rename
                </button>
                <button type="button" className="link-btn link-btn--danger" onClick={() => setConfirmDelete(true)}>
                  Delete
                </button>
              </div>
            )}
          </div>

          {error && (
            <p className="home-error" role="alert">
              {error}
            </p>
          )}

          {!team && !error && (
            <EmptyState
              variant="panel"
              icon={<UsersIcon size={18} />}
              title="No team yet"
              description="Create a team, then invite the people you work with."
              action={
                <button type="button" className="btn btn-primary w-auto" onClick={() => setNameDialog('create')}>
                  Create team
                </button>
              }
            />
          )}

          {team && (
            <>
              <p className="home-team-name">{team.name}</p>

              <ul className="member-list member-list--flat">
                {team.members.map((member) => (
                  <li key={member.id} className="member">
                    <span
                      className="avatar"
                      style={{ '--tone': toneOf(member.id) } as CSSProperties}
                      aria-hidden="true"
                    >
                      {initialsOf(member.displayName)}
                    </span>

                    <span className="member-text">
                      <span className="member-name">
                        {member.displayName}
                        {member.id === user?.id && <span className="member-you">you</span>}
                      </span>
                      <span className="member-handle">@{member.username}</span>
                    </span>

                    {member.role === 'owner' ? (
                      <span className="badge">Owner</span>
                    ) : (
                      <button
                        type="button"
                        className="icon-button member-remove"
                        onClick={() => void removeMember(member)}
                        aria-label={`Remove ${member.displayName} from the team`}
                        title="Remove from team"
                      >
                        <XIcon size={14} />
                      </button>
                    )}
                  </li>
                ))}
                {/* Asked, not joined: the owner sees who has not answered yet. */}
                {team.invitations.map((invitation) => (
                  <li key={invitation.id} className="member member--invited">
                    <span
                      className="avatar"
                      style={{ '--tone': toneOf(invitation.personId) } as CSSProperties}
                      aria-hidden="true"
                    >
                      {initialsOf(invitation.displayName)}
                    </span>

                    <span className="member-text">
                      <span className="member-name">
                        {invitation.displayName}
                        <span className="member-you">invited</span>
                      </span>
                      <span className="member-handle">{invitation.email}</span>
                    </span>

                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => void cancelInvite(invitation)}
                      aria-label={`Cancel the invitation to ${invitation.displayName}`}
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>

              {team.invitations.length > 0 && (
                <p className="home-team-note">
                  Invited people join when they accept, on their own Home screen.
                </p>
              )}

              <div className="home-team-foot">
                <button type="button" className="btn btn-ghost btn-sm w-auto" onClick={() => setAddOpen(true)}>
                  Invite member
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      {memberOf.length > 0 && (
        <section className="home-memberof" aria-labelledby="home-memberof-title">
          <h2 id="home-memberof-title" className="home-section-title">
            Member of
          </h2>
          <ul className="member-list member-list--flat">
            {memberOf.map((other) => (
              <li key={other.id} className="member">
                <span className="avatar" style={{ '--tone': toneOf(other.ownerId) } as CSSProperties} aria-hidden="true">
                  {initialsOf(other.ownerName)}
                </span>
                <span className="member-text">
                  <span className="member-name">{other.name}</span>
                  <span className="member-handle">
                    {other.ownerName} · {other.memberCount} {other.memberCount === 1 ? 'member' : 'members'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <TeamNameDialog
        open={nameDialog !== null}
        mode={nameDialog ?? 'create'}
        initialName={nameDialog === 'rename' ? (team?.name ?? '') : ''}
        onClose={() => setNameDialog(null)}
        onSaved={onTeamSaved}
      />

      <AddTeamMemberDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        pending={team?.invitations ?? []}
        onInvited={(next) => {
          setOverview((current) => ({ owned: next, memberOf: current?.memberOf ?? [] }))
          void refreshInvitations()
        }}
        onCancel={(invitation) => void cancelInvite(invitation)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this team?"
        confirmLabel="Delete team"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void deleteTeam()}
      >
        The roster goes with it. Nobody loses their account, and nothing they have written is
        touched.
      </ConfirmDialog>
    </Page>
  )
}
