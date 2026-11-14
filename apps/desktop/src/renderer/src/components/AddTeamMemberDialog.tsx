import { useEffect, useRef, useState } from 'react'
import type { InvitationSummary, TeamDetail, UserSummary } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import Avatar from './Avatar'
import { CheckIcon, SearchIcon, UserPlusIcon, XIcon } from './icons'

interface AddTeamMemberDialogProps {
  open: boolean
  onClose: () => void
  /** Questions already asked and not yet answered. */
  pending: InvitationSummary[]
  onInvited: (team: TeamDetail) => void
  onCancel: (invitation: InvitationSummary) => void
}

/**
 * Inviting somebody is done by email address, and it is an invitation.
 *
 * Names collide — and an initials avatar makes two people with the same name
 * look like the same person — so the one thing that identifies an account is
 * the address it was registered with. The lookup is exact and happens in the
 * main process; the people already on the team, and the people already asked,
 * are filtered out there too, so the UI is never given a choice that would fail.
 *
 * What comes back shows the *name*, because the person inviting needs to see
 * who they are inviting. Nothing is shared by sending this: the person joins
 * only by accepting, on their own Home screen, and until then the roster shows
 * them as invited. The dialog stays open afterwards, because inviting two
 * colleagues in a row is the usual case.
 */
export default function AddTeamMemberDialog({
  open,
  onClose,
  pending,
  onInvited,
  onCancel
}: AddTeamMemberDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [invitingId, setInvitingId] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults(null)
    setSearching(false)
    setInvitingId(null)
    setSentTo(null)
    setError(null)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    // Nothing is asked of the database until the text could be an address.
    if (trimmed.length < 5 || !trimmed.includes('@')) {
      setResults(null)
      setSearching(false)
      return
    }

    let active = true
    setSearching(true)
    const timer = window.setTimeout(() => {
      api.team
        .search(trimmed)
        .then((found) => {
          if (!active) return
          setResults(found)
          setError(null)
        })
        .catch((failure) => {
          if (active) setError(errorMessage(failure))
        })
        .finally(() => {
          if (active) setSearching(false)
        })
    }, 220)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [query, open])

  async function invite(person: UserSummary): Promise<void> {
    if (invitingId) return
    setInvitingId(person.id)
    setError(null)
    setSentTo(null)
    try {
      const team = await api.team.invite(person.id)
      onInvited(team)
      setSentTo(person.displayName)
      setQuery('')
      setResults(null)
      inputRef.current?.focus()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setInvitingId(null)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal modal--sm"
      aria-labelledby="add-member-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!invitingId) onClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && !invitingId) onClose()
      }}
    >
      <div className="modal-panel">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <div>
            <h2 id="add-member-title" className="text-[17px] font-semibold text-[var(--ink)]">
              Invite to team
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-tertiary)]">
              You choose someone. They decide whether to join — and joining means they can
              work in the projects you own.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
            disabled={Boolean(invitingId)}
          >
            <XIcon size={15} />
          </button>
        </div>

        <div className="px-6">
          <div className="member-search">
            <SearchIcon size={14} className="member-search-icon" />
            <input
              ref={inputRef}
              className="field-input member-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Email address"
              type="email"
              spellCheck={false}
              autoComplete="off"
              aria-label="Email address of the person to invite"
            />
          </div>
        </div>

        {sentTo && (
          <p className="invite-sent" role="status">
            <CheckIcon size={14} />
            Invitation sent to {sentTo}. They will see it on their Home screen.
          </p>
        )}

        <div className="member-results">
          {query.trim().length === 0 ? (
            <p className="member-empty">
              People are found by the email address they signed up with. Names repeat; an address
              does not.
            </p>
          ) : query.trim().length < 5 || !query.includes('@') ? (
            <p className="member-empty">Keep typing — an email address, like name@gmail.com.</p>
          ) : searching && !results ? (
            <p className="member-empty">Searching…</p>
          ) : results && results.length === 0 ? (
            <p className="member-empty">
              No account uses <strong className="member-empty-query">{query.trim()}</strong>.
            </p>
          ) : (
            <ul className="member-list">
              {(results ?? []).map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    className="member-choice"
                    onClick={() => void invite(person)}
                    disabled={Boolean(invitingId)}
                  >
                    <Avatar name={person.displayName} avatar={person.avatar} />
                    <span className="member-choice-text">
                      <span className="member-choice-name">{person.displayName}</span>
                      <span className="member-choice-handle">{person.email}</span>
                    </span>
                    {invitingId === person.id ? (
                      <span className="spinner" aria-hidden="true" />
                    ) : (
                      <UserPlusIcon size={15} className="member-choice-add" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {pending.length > 0 && (
          <div className="invite-pending">
            <div className="invite-pending-head">Waiting for an answer</div>
            <ul className="member-list">
              {pending.map((invitation) => (
                <li key={invitation.id} className="member">
                  <Avatar name={invitation.displayName} />
                  <span className="member-text">
                    <span className="member-name">{invitation.displayName}</span>
                    <span className="member-handle">{invitation.email}</span>
                  </span>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => onCancel(invitation)}
                    aria-label={`Cancel the invitation to ${invitation.displayName}`}
                  >
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p className="px-6 pb-4 text-sm text-[var(--danger)]" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] px-6 py-4">
          <span className="text-xs text-[var(--ink-tertiary)]">
            Nothing opens until they accept.
          </span>
          <button type="button" className="btn btn-ghost w-auto" onClick={onClose} disabled={Boolean(invitingId)}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  )
}
