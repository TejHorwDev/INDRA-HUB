import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { TeamDetail, UserSummary } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import { initialsOf, toneOf } from '../lib/format'
import { SearchIcon, UserPlusIcon, XIcon } from './icons'

interface AddTeamMemberDialogProps {
  open: boolean
  onClose: () => void
  onAdded: (team: TeamDetail) => void
}

/**
 * Adding somebody is done by email address.
 *
 * Names collide — and an initials avatar makes two people with the same name
 * look like the same person — so the one thing that identifies an account is
 * the address it was registered with. The lookup is exact and happens in the
 * main process; the people already on the team are filtered out there too, so
 * the UI is never given a choice that would fail.
 *
 * What comes back shows the *name*, because the person adding somebody needs to
 * see who they are adding, not just confirm an address they already typed.
 */
export default function AddTeamMemberDialog({ open, onClose, onAdded }: AddTeamMemberDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
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
    setAddingId(null)
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

  async function add(person: UserSummary): Promise<void> {
    if (addingId) return
    setAddingId(person.id)
    setError(null)
    try {
      const team = await api.team.addMember(person.id)
      onAdded(team)
      onClose()
    } catch (failure) {
      setError(errorMessage(failure))
      setAddingId(null)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal modal--sm"
      aria-labelledby="add-member-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!addingId) onClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && !addingId) onClose()
      }}
    >
      <div className="modal-panel">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <h2 id="add-member-title" className="text-[17px] font-semibold text-[var(--ink)]">
            Add to team
          </h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
            disabled={Boolean(addingId)}
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
              aria-label="Email address of the person to add"
            />
          </div>
        </div>

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
                    onClick={() => void add(person)}
                    disabled={Boolean(addingId)}
                  >
                    <span className="avatar" style={{ '--tone': toneOf(person.id) } as CSSProperties}>
                      {initialsOf(person.displayName)}
                    </span>
                    <span className="member-choice-text">
                      <span className="member-choice-name">{person.displayName}</span>
                      <span className="member-choice-handle">{person.email}</span>
                    </span>
                    {addingId === person.id ? (
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

        {error && (
          <p className="px-6 pb-4 text-sm text-[var(--danger)]" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end border-t border-[var(--line)] px-6 py-4">
          <button type="button" className="btn btn-ghost w-auto" onClick={onClose} disabled={Boolean(addingId)}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  )
}
