import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { CloudProjectState, InvitationSummary, ProjectDetail, ProjectMember } from '@shared/types'
import AddMemberDialog from '../components/AddMemberDialog'
import EmptyState from '../components/EmptyState'
import Page from '../components/Page'
import ProjectTabs from '../components/ProjectTabs'
import RemoveMemberDialog from '../components/RemoveMemberDialog'
import { useToast } from '../components/ToastProvider'
import { AlertCircleIcon, CloudIcon, FolderIcon, PlusIcon, SaveIcon } from '../components/icons'
import { api, errorCode, errorMessage } from '../lib/api'
import { cancelInvitation } from '../lib/invitations'
import { useConnectivity } from '../lib/connectivity'
import { useSession } from '../lib/session'
import { formatDate, formatRelative, initialsOf } from '../lib/format'
import { Skeleton } from '../components/Skeleton'

type LoadState = 'loading' | 'ready' | 'missing' | 'error'

export default function ProjectDashboardScreen() {
  const { projectId = '' } = useParams()
  const toast = useToast()
  const { offline } = useConnectivity()
  const { user } = useSession()
  /* No account behind this session, so there is no cloud copy to write. */
  const noAccount = offline || user?.mode === 'offline'

  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [cloud, setCloud] = useState<CloudProjectState | null>(null)
  const [pushing, setPushing] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<ProjectMember | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  /*
   * A copy on this PC: the working copy already lives here, but a file can
   * leave — on a stick, in a folder, into a backup — and open on a machine
   * that never sees the internet. The dialog is the system's own, so the user
   * picks the place and owns the result.
   */
  /**
   * The other copy: the same project in this installation's own cloud
   * database, reachable from any PC that installation signs in on. Offline the
   * button is inert — the cloud is not something this app pretends to reach.
   */
  async function saveToCloud(): Promise<void> {
    if (pushing || noAccount) return
    setPushing(true)
    try {
      const result = await api.cloud.push(projectId)
      setCloud(await api.cloud.project(projectId))
      const total = result.documents + result.presentations
      toast.success(
        total === 0 ? 'Project saved to the cloud.' : `Saved to the cloud — ${total} items.`
      )
    } catch (failure) {
      toast.error(errorMessage(failure))
    } finally {
      setPushing(false)
    }
  }

  async function saveCopy(): Promise<void> {
    if (saving) return
    setSaving(true)
    try {
      const result = await api.projects.exportFile(projectId)
      if (result) {
        const name = result.filePath.split(/[\\/]/).pop() ?? 'project'
        toast.success(`Saved ${name}.`)
      }
    } catch (failure) {
      toast.error(errorMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  const load = useCallback(async () => {
    setState('loading')
    setError(null)
    try {
      const detail = await api.projects.get(projectId)
      setProject(detail)
      // Read from disk, so this works with no connection at all.
      setCloud(await api.cloud.project(projectId).catch(() => null))
      setState('ready')
    } catch (failure) {
      if (errorCode(failure) === 'NOT_FOUND') {
        setState('missing')
        return
      }
      if (errorCode(failure) === 'AUTH_REQUIRED') {
        setState('missing')
        return
      }
      setError(errorMessage(failure))
      setState('error')
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  async function cancelInvite(invitation: InvitationSummary): Promise<void> {
    try {
      await cancelInvitation(invitation.id)
      setProject(await api.projects.get(projectId))
      toast.success(`Invitation to ${invitation.displayName} cancelled.`)
    } catch (failure) {
      toast.error(errorMessage(failure))
    }
  }

  async function confirmRemove() {
    if (!removeTarget || !project) return
    setRemoving(true)
    setRemoveError(null)
    try {
      const updated = await api.projects.removeMember({
        projectId: project.id,
        userId: removeTarget.userId
      })
      setProject(updated)
      toast.success(`${removeTarget.displayName} was removed.`)
      setRemoveTarget(null)
    } catch (failure) {
      setRemoveError(errorMessage(failure))
    } finally {
      setRemoving(false)
    }
  }

  if (state === 'loading') {
    return (
      <Page title="Project">
        <div className="space-y-6" aria-busy="true" aria-label="Loading project">
          <Skeleton height={14} width={220} />
          <Skeleton height={12} width={320} />
          <div className="project-layout">
            <Skeleton height={190} radius={8} />
            <Skeleton height={190} radius={8} />
          </div>
        </div>
      </Page>
    )
  }

  if (state === 'missing') {
    return (
      <Page title="Project unavailable">
        <EmptyState
          icon={<FolderIcon size={18} />}
          title="You can’t open this project"
          description="It may have been deleted, or your account isn’t on its team. Ask the head developer for access."
          action={
            <Link to="/dashboard" className="btn btn-ghost w-auto">
              Back to projects
            </Link>
          }
        />
      </Page>
    )
  }

  if (state === 'error' || !project) {
    return (
      <Page title="Project">
        <EmptyState
          icon={<AlertCircleIcon size={18} />}
          title="Couldn’t load this project"
          description={error ?? 'Something went wrong. Please try again.'}
          action={
            <button type="button" className="btn btn-ghost w-auto" onClick={() => void load()}>
              Try again
            </button>
          }
        />
      </Page>
    )
  }

  const isOwner = project.role === 'owner'
  const teamSize = project.memberCount + 1
  const team = project.team
  const viaTeam = project.members.filter((member) => member.via === 'team')

  return (
    <>
      <Page
        title={project.name}
        description={project.description || undefined}
        tabs={<ProjectTabs projectId={project.id} />}
        actions={
          <div className="flex flex-none items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost w-auto"
              onClick={() => void saveToCloud()}
              disabled={pushing || noAccount || !isOwner}
              title={
                noAccount
                  ? 'The cloud copy is unavailable while this PC is offline'
                  : isOwner
                    ? 'Save this project to its cloud copy'
                    : 'Only the head developer can save this project to the cloud'
              }
            >
              {pushing ? <span className="spinner" aria-hidden="true" /> : <CloudIcon size={14} />}
              Save to cloud
            </button>
            <button
              type="button"
              className="btn btn-ghost w-auto"
              onClick={() => void saveCopy()}
              disabled={saving}
              title="Write this project to a file on this PC"
            >
              {saving ? <span className="spinner" aria-hidden="true" /> : <SaveIcon size={14} />}
              Save to PC
            </button>
            <Link to={`/project/${project.id}/workspace`} className="btn btn-ghost w-auto">
              Open workspace
            </Link>
            {isOwner && (
              <button
                type="button"
                className="btn btn-primary w-auto"
                onClick={() => setAddOpen(true)}
              >
                <PlusIcon size={15} />
                Invite member
              </button>
            )}
          </div>
        }
      >
        <div className="project-layout">
          <section className="card" aria-label="Project overview">
            <div className="panel-head">Overview</div>
            <dl className="info-list">
              <div className="info-row">
                <dt>Head developer</dt>
                <dd>
                  {project.owner.displayName}{' '}
                  <span className="text-[var(--ink-tertiary)]">@{project.owner.username}</span>
                </dd>
              </div>
              <div className="info-row">
                <dt>Created</dt>
                <dd>{formatDate(project.createdAt)}</dd>
              </div>
              <div className="info-row">
                <dt>Last activity</dt>
                <dd>{formatRelative(project.updatedAt)}</dd>
              </div>
              <div className="info-row">
                <dt>People</dt>
                <dd>
                  {teamSize} {teamSize === 1 ? 'person' : 'people'}
                  {viaTeam.length > 0 && team ? (
                    <span className="text-[var(--ink-tertiary)]"> · {viaTeam.length} from {team.name}</span>
                  ) : null}
                </dd>
              </div>
              <div className="info-row">
                <dt>Your access</dt>
                <dd>
                  {isOwner
                    ? 'Head developer'
                    : project.via === 'team' && team
                      ? `Member · through ${team.name}`
                      : 'Member · invited'}
                </dd>
              </div>
              <div className="info-row">
                <dt>On this PC</dt>
                <dd>Yes — opens offline</dd>
              </div>
              <div className="info-row">
                <dt>Cloud copy</dt>
                <dd>
                  {!cloud?.pushedAt
                    ? noAccount
                      ? 'Needs an account'
                      : isOwner
                        ? 'Not saved yet'
                        : 'Saved by the head developer'
                    : cloud.stale
                      ? `Saved ${formatRelative(cloud.pushedAt)} · newer work here`
                      : `Saved ${formatRelative(cloud.pushedAt)}`}
                </dd>
              </div>
            </dl>

            <p className="info-foot">
              {isOwner
                ? team && team.memberCount > 0
                  ? `Everyone on ${team.name} (${team.memberCount}) can open this project, and anyone else gets in by invitation. Only you can invite or remove.`
                  : 'Only you can open this project until you invite someone — or start a team, which opens your projects to its members.'
                : project.via === 'team' && team
                  ? `You can work here because you are on ${team.name}.`
                  : 'Your access comes from an invitation the head developer sent, and they can take it back.'}
            </p>
          </section>

          <section className="card" aria-label="Project team">
            <div className="panel-head">
              <span>Team</span>
              <span className="panel-head-count">{teamSize}</span>
            </div>

            <ul className="team-list">
              <li className="team-row">
                <span className="team-avatar">{initialsOf(project.owner.displayName)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="team-name">{project.owner.displayName}</span>
                    <span className="badge badge--accent">Head developer</span>
                  </span>
                  <span className="team-handle">@{project.owner.username}</span>
                </span>
                <span className="team-joined">Created {formatDate(project.createdAt)}</span>
              </li>

              {project.members.map((member) => (
                <li className="team-row" key={member.userId}>
                  <span className="team-avatar">{initialsOf(member.displayName)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="team-name">{member.displayName}</span>
                      <span className={member.via === 'team' ? 'badge' : 'badge badge--accent'}>
                        {member.via === 'team' ? 'Team' : 'Member'}
                      </span>
                    </span>
                    <span className="team-handle">
                      @{member.username}
                      {member.via === 'team' ? ' · through your team' : ''}
                    </span>
                  </span>
                  <span className="team-joined">
                    {member.via === 'team' ? 'Team since' : 'Joined'} {formatDate(member.joinedAt)}
                  </span>
                  {isOwner && member.via === 'invite' && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm w-auto"
                      onClick={() => {
                        setRemoveError(null)
                        setRemoveTarget(member)
                      }}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}

              {project.invitations.map((invitation) => (
                <li className="team-row" key={invitation.id}>
                  <span className="team-avatar">{initialsOf(invitation.displayName)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="team-name">{invitation.displayName}</span>
                      <span className="badge">Invited</span>
                    </span>
                    <span className="team-handle">{invitation.email}</span>
                  </span>
                  <span className="team-joined">Asked {formatRelative(invitation.createdAt)}</span>
                  {isOwner && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm w-auto"
                      onClick={() => void cancelInvite(invitation)}
                    >
                      Cancel
                    </button>
                  )}
                </li>
              ))}

              {project.members.length === 0 && project.invitations.length === 0 && (
                <li className="team-empty">
                  <span>
                    {team && team.memberCount > 0
                      ? `Nobody from ${team.name} has joined the app yet.`
                      : 'No one else is on this project yet.'}
                  </span>
                  {isOwner && (
                    <button
                      type="button"
                      className="link-quiet text-sm"
                      onClick={() => setAddOpen(true)}
                    >
                      Add the first member
                    </button>
                  )}
                </li>
              )}
            </ul>
          </section>
        </div>
      </Page>

      <AddMemberDialog
        open={addOpen}
        projectId={project.id}
        teamName={team ? team.name : null}
        pending={project.invitations}
        onClose={() => setAddOpen(false)}
        onInvited={setProject}
        onCancel={(invitation) => void cancelInvite(invitation)}
      />

      <RemoveMemberDialog
        member={removeTarget}
        pending={removing}
        error={removeError}
        onCancel={() => {
          if (!removing) setRemoveTarget(null)
        }}
        onConfirm={() => void confirmRemove()}
      />
    </>
  )
}
