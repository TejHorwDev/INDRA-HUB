import { useEffect, useRef } from 'react'
import type { ProjectMember } from '@shared/types'
import { initialsOf } from '../lib/format'
import { XIcon } from './icons'

interface RemoveMemberDialogProps {
  member: ProjectMember | null
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

/** Removing someone is destructive, so it always goes through this gate. */
export default function RemoveMemberDialog({
  member,
  pending,
  error,
  onCancel,
  onConfirm
}: RemoveMemberDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (member && !dialog.open) dialog.showModal()
    if (!member && dialog.open) dialog.close()
  }, [member])

  return (
    <dialog
      ref={dialogRef}
      className="modal modal--sm"
      aria-labelledby="remove-member-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!pending) onCancel()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && !pending) onCancel()
      }}
    >
      <div className="modal-panel">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
          <h2 id="remove-member-title" className="text-[17px] font-semibold text-[var(--ink)]">
            Remove member
          </h2>
          <button
            type="button"
            className="icon-button"
            onClick={onCancel}
            aria-label="Close"
            disabled={pending}
          >
            <XIcon size={15} />
          </button>
        </div>

        <div className="px-6 pb-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="team-avatar">{member ? initialsOf(member.displayName) : '?'}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-[var(--ink)]">
                {member?.displayName}
              </span>
              <span className="block truncate text-xs text-[var(--ink-tertiary)]">
                @{member?.username}
              </span>
            </span>
          </div>

          <p className="text-sm text-[var(--ink-secondary)]">
            They lose access to this project immediately. The project, its ownership and everyone
            else on the team stay untouched.
          </p>

          {error && (
            <p className="mt-3 text-sm text-[var(--danger)]" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-6 py-4">
          <button
            type="button"
            className="btn btn-ghost w-auto"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </button>
          <button type="button" className="btn btn-primary w-auto" onClick={onConfirm} disabled={pending}>
            {pending && <span className="spinner" aria-hidden="true" />}
            {pending ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>
    </dialog>
  )
}
