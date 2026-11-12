import { useEffect, useRef, useState } from 'react'
import type { ProjectDetail, UserSummary } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import { initialsOf } from '../lib/format'
import TextField from './TextField'
import { useToast } from './ToastProvider'
import { SearchIcon, XIcon } from './icons'

interface AddMemberDialogProps {
  open: boolean
  projectId: string
  onClose: () => void
  onUpdated: (project: ProjectDetail) => void
}

/**
 * Search runs against registered accounts only, and the main process filters
 * out the owner and anyone already on the project before returning results.
 */
export default function AddMemberDialog({
  open,
  projectId,
  onClose,
  onUpdated
}: AddMemberDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const toast = useToast()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

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
  }, [open])

  useEffect(() => {
    if (!open) return

    const trimmed = query.trim()
    if (trimmed.length < 2) {
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

  async function addMember(user: UserSummary) {
    setAddingId(user.id)
    setAddError(null)
    try {
      const updated = await api.projects.addMember({ projectId, userId: user.id })
      onUpdated(updated)
      setResults((current) => current?.filter((candidate) => candidate.id !== user.id) ?? null)
      toast.success(`${user.displayName} joined the project.`)
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
              Add member
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-tertiary)]">
              Find someone with an INDRA HUB account.
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <XIcon size={15} />
          </button>
        </div>

        <div className="px-6 pb-4">
          <TextField
            label="Search accounts"
            name="memberSearch"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Username or name"
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
        </div>

        <div
          className={
            results && results.length > 0 ? 'px-3 pb-3' : 'min-h-[168px] px-3 pb-3'
          }
        >
          {query.trim().length < 2 ? (
            <p className="member-hint">
              <SearchIcon size={14} />
              Type at least two characters to search.
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
            <p className="member-hint">No accounts match “{query.trim()}”.</p>
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
                      @{user.username}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm w-auto"
                    onClick={() => void addMember(user)}
                    disabled={addingId !== null}
                  >
                    {addingId === user.id ? 'Adding…' : 'Add'}
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

        <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] px-6 py-4">
          <span className="text-xs text-[var(--ink-tertiary)]">
            Only the head developer can add people.
          </span>
          <button type="button" className="btn btn-ghost w-auto" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  )
}
