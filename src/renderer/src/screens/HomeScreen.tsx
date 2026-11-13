import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { TeamDetail, TeamOverview } from '@shared/types'
import AddTeamMemberDialog from '../components/AddTeamMemberDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import EmptyState from '../components/EmptyState'
import Page from '../components/Page'
import TeamNameDialog from '../components/TeamNameDialog'
import { useToast } from '../components/ToastProvider'
import { UsersIcon, XIcon } from '../components/icons'
import { api, errorMessage } from '../lib/api'
import { initialsOf, toneOf } from '../lib/format'
import { useSession } from '../lib/session'

/**
 * Home: who you are, and who you work with.
 *
 * Two things, side by side, and nothing else. The profile is the account the
 * app is signed in as; the team is the standing group this installation knows
 * about, with the roster, the one action that matters (add someone) and the
 * removal that a roster needs. Everything else the app can do has its own
 * place already — a home screen that repeats it is just a menu with a hero.
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
              description="Create a team, then add the people you work with."
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
              </ul>

              <div className="home-team-foot">
                <button type="button" className="btn btn-ghost btn-sm w-auto" onClick={() => setAddOpen(true)}>
                  Add member
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
        onAdded={(next) => {
          setOverview((current) => ({ owned: next, memberOf: current?.memberOf ?? [] }))
          toast.success('Added to the team.')
        }}
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
