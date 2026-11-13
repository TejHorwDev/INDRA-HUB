import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type {
  InvitationSummary,
  ProjectSummary,
  SharedInvitation,
  TeamDetail,
  TeamOverview
} from '@shared/types'
import AddTeamMemberDialog from '../components/AddTeamMemberDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import EmptyState from '../components/EmptyState'
import Page from '../components/Page'
import ProjectCard from '../components/ProjectCard'
import TeamNameDialog from '../components/TeamNameDialog'
import { useToast } from '../components/ToastProvider'
import { FolderIcon, MailIcon, UsersIcon, XIcon } from '../components/icons'
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
import { useConnectivity } from '../lib/connectivity'

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
  const navigate = useNavigate()

  const [overview, setOverview] = useState<TeamOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nameDialog, setNameDialog] = useState<'create' | 'rename' | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [answeringId, setAnsweringId] = useState<string | null>(null)
  const { offline } = useConnectivity()
  const invitations = useInvitations()

  /*
   * Invitations from another PC arrive through the cloud, so they are fetched
   * rather than read from this machine's database — and only when there is a
   * connection to fetch them with. Offline, the section simply is not there,
   * which is honest: unanswered questions will still be waiting later.
   */
  /*
   * The work most recently touched, so Home is a place to continue rather than
   * a place to look at yourself. It is the same list the Projects page reads;
   * nothing is computed and nothing is invented — four cards, in the order the
   * projects already come in.
   */
  const [projects, setProjects] = useState<ProjectSummary[]>([])

  const [remoteInvites, setRemoteInvites] = useState<SharedInvitation[]>([])
  const [answeringRemote, setAnsweringRemote] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.projects
      .list()
      .then((list) => {
        if (!cancelled) setProjects(list.slice(0, 3))
      })
      .catch(() => {
        // Home is still useful without them; the Projects page owns the error.
        if (!cancelled) setProjects([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (offline) {
      setRemoteInvites([])
      return
    }
    let cancelled = false
    api.share
      .inbox()
      .then((list) => {
        if (!cancelled) setRemoteInvites(list)
      })
      .catch(() => {
        if (!cancelled) setRemoteInvites([])
      })
    return () => {
      cancelled = true
    }
  }, [offline])

  async function answerRemote(invitation: SharedInvitation, accept: boolean): Promise<void> {
    setAnsweringRemote(invitation.id)
    try {
      const result = await api.share.answer(invitation.id, invitation.cloudId, accept)
      setRemoteInvites((current) => current.filter((entry) => entry.id !== invitation.id))
      if (accept && result.project) {
        toast.success(`${invitation.projectName} is on this PC now.`)
        navigate(`/project/${result.project.id}`)
        return
      }
      if (accept) {
        toast.success(`Joined ${invitation.projectName}.`)
      } else {
        toast.success(`You declined the invitation to ${invitation.projectName}.`)
      }
    } catch (failure) {
      toast.error(errorMessage(failure))
    } finally {
      setAnsweringRemote(null)
    }
  }

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

      if (!result.accepted) {
        toast.success(`You declined the invitation to ${result.targetName}.`)
      } else if (result.kind === 'project') {
        toast.success(`You joined ${result.targetName}.`)
        // Straight to the work. Accepting is a decision to join in, not a
        // decision to go looking for the project afterwards.
        navigate(`/project/${result.targetId}`)
      } else {
        toast.success(`You joined ${result.targetName}. Their projects are now on your Projects page.`)
        await load()
      }
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
                    {invitation.kind === 'project'
                      ? `${invitation.invitedByName} invited you to work on this project — its documents and presentations.`
                      : `${invitation.invitedByName} invited you to their team. Their projects open to you as soon as you join.`}
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

      {remoteInvites.length > 0 && (
        <section className="home-invites" aria-labelledby="home-remote-title">
          <div className="home-section-head">
            <h2 id="home-remote-title" className="home-section-title">
              From another PC
            </h2>
            <span className="home-count">
              {remoteInvites.length} waiting for you
            </span>
          </div>

          <ul className="invite-list">
            {remoteInvites.map((invitation) => (
              <li key={invitation.id} className="invite-card">
                <span className="invite-mark" aria-hidden="true">
                  <MailIcon size={16} />
                </span>

                <span className="invite-text">
                  <span className="invite-title">
                    {invitation.projectName}
                    <span className="badge">Other PC</span>
                  </span>
                  <span className="invite-sub">
                    {invitation.invitedByName} invited you to work on this project. Accepting
                    brings it onto this PC, with its documents and presentations.
                  </span>
                </span>

                <span className="invite-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm w-auto"
                    onClick={() => void answerRemote(invitation, true)}
                    disabled={answeringRemote !== null}
                  >
                    {answeringRemote === invitation.id ? (
                      <span className="spinner" aria-hidden="true" />
                    ) : null}
                    Accept
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm w-auto"
                    onClick={() => void answerRemote(invitation, false)}
                    disabled={answeringRemote !== null}
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
          {/*
            * Identity reads as one block: the monogram and the two lines that
            * name the account sit together in a header, the address is a row
            * of its own, and the footer carries the only two facts left.
            */}
          <div className="home-profile-head">
            <span className="avatar avatar--lg" style={{ '--tone': toneOf(user?.id ?? '') } as CSSProperties}>
              {initialsOf(user?.displayName ?? '')}
            </span>

            <div className="home-profile-text">
              <h2 className="home-name">{user?.displayName}</h2>
              <p className="home-handle">@{user?.username}</p>
            </div>
          </div>

          <p className="home-email">{user?.email}</p>

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

              {team.memberCount > 1 && (
                <p className="home-team-note">
                  Everyone here can open the projects you own and work in them with you. There
                  is nothing to invite twice.
                </p>
              )}

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

      {projects.length > 0 && (
        <section className="home-recents" aria-labelledby="home-recents-title">
          <div className="home-section-head">
            <h2 id="home-recents-title" className="home-section-title">
              Recent projects
            </h2>
            <span className="home-count">{projects.length}</span>
            <Link to="/dashboard" className="link home-section-actions">
              All projects
            </Link>
          </div>

          <ul className="project-list project-list--three">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={() => navigate(`/project/${project.id}`)}
              />
            ))}
          </ul>
        </section>
      )}

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
