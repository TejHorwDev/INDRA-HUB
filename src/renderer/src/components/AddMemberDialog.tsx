import { useEffect, useRef, useState } from 'react'
import type { InvitationSummary, ProjectDetail, UserSummary } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import { initialsOf } from '../lib/format'
import TextField from './TextField'
import { useToast } from './ToastProvider'
import { SearchIcon, XIcon } from './icons'

interface AddMemberDialogProps {
  open: boolean
  projectId: string
  /** Questions already asked and not yet answered. */
  pending: InvitationSummary[]
  onClose: () => void
  onInvited: (project: ProjectDetail) => void
  onCancel: (invitation: InvitationSummary) => void
}

/**
 * Inviting somebody to a project is done by email address, for the same reason
 * the team dialog is: names repeat, addresses do not. The match is exact, and
 * the main process filters out the owner, anyone already on the project and
 * anyone already asked — the person's name comes back so the choice is made by
 * name.
 *
 * It is an invitation in the same sense as the team one: the project is not
 * opened to the person until they accept it themselves.
 */
export default function AddMemberDialog({
  open,
  projectId,
  pending,
  onClose,
  onInvited,
  onCancel
}: AddMemberDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const toast = useToast()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

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
    setSearchError(null)
    setAddError(null)
    setAddingId(null)
    setSentTo(null)
  }, [open])

  useEffect(() => {
    if (!open) return

    const trimmed = query.trim()
    if (trimmed.length < 5 || !trimmed.includes('@')) {
      setResults(null)
      setSearchError(null)
      setSearching(false)
      return
    }

    let cancelled = false
    setSearching(true)

    const timer = window.setTimeout(() => {
      api.users
        .search({ projectId, query: trimmed })
        .then((users) => {
          if (!cancelled) {
            setResults(users)
            setSearchError(null)
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setResults([])
            setSearchError(errorMessage(error))
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, projectId, query])

  async function inviteMember(user: UserSummary) {
    setAddingId(user.id)
    setAddError(null)
    setSentTo(null)
    try {
      const updated = await api.projects.invite({ projectId, userId: user.id })
      onInvited(updated)
      setResults((current) => current?.filter((candidate) => candidate.id !== user.id) ?? null)
      setQuery('')
      setSentTo(user.displayName)
      toast.success(`Invitation sent to ${user.displayName}.`)
    } catch (error) {
      setAddError(errorMessage(error))
    } finally {
      setAddingId(null)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby="add-member-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
    >
      <div className="modal-panel">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <div>
            <h2 id="add-member-title" className="text-[17px] font-semibold text-[var(--ink)]">
              Invite member
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-tertiary)]">
              By the email they signed up with. They can accept or decline.
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <XIcon size={15} />
          </button>
        </div>

        <div className="px-6 pb-4">
          <TextField
            label="Email address"
            name="memberSearch"
            type="email"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="name@gmail.com"
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </div>

        {sentTo && (
          <p className="invite-sent" role="status">
            Invitation sent to {sentTo}. They will see it on their Home screen.
          </p>
        )}

        <div
          className={
            results && results.length > 0 ? 'px-3 pb-3' : 'min-h-[168px] px-3 pb-3'
          }
        >
          {query.trim().length === 0 ? (
            <p className="member-hint">
              <SearchIcon size={14} />
              Type the email address they signed up with.
            </p>
          ) : query.trim().length < 5 || !query.includes('@') ? (
            <p className="member-hint">
              <SearchIcon size={14} />
              Keep typing — an email address, like name@gmail.com.
            </p>
          ) : searching ? (
            <p className="member-hint">
              <span className="spinner" aria-hidden="true" />
              Searching…
            </p>
          ) : searchError ? (
            <p className="member-hint member-hint--error" role="alert">
              {searchError}
            </p>
          ) : results && results.length === 0 ? (
            <p className="member-hint">No account uses “{query.trim()}”.</p>
          ) : (
            <ul className="member-results">
              {results?.map((user) => (
                <li key={user.id} className="member-result">
                  <span className="team-avatar">{initialsOf(user.displayName)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--ink)]">
                      {user.displayName}
                    </span>
                    <span className="block truncate text-xs text-[var(--ink-tertiary)]">
                      {user.email}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm w-auto"
                    onClick={() => void inviteMember(user)}
                    disabled={addingId !== null}
                  >
                    {addingId === user.id ? 'Sending…' : 'Invite'}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {addError && (
            <p className="member-hint member-hint--error" role="alert">
              {addError}
            </p>
          )}
        </div>

        {pending.length > 0 && (
          <div className="invite-pending">
            <div className="invite-pending-head">Waiting for an answer</div>
            <ul className="member-results">
              {pending.map((invitation) => (
                <li key={invitation.id} className="member-result">
                  <span className="team-avatar">{initialsOf(invitation.displayName)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--ink)]">
                      {invitation.displayName}
                    </span>
                    <span className="block truncate text-xs text-[var(--ink-tertiary)]">
                      {invitation.email}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm w-auto"
                    onClick={() => onCancel(invitation)}
                  >
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] px-6 py-4">
          <span className="text-xs text-[var(--ink-tertiary)]">
            Nothing is shared until they accept.
          </span>
          <button type="button" className="btn btn-ghost w-auto" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  )
}
