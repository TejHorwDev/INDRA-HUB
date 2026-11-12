import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { XIcon } from './icons'

interface ConfirmDialogProps {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  pending?: boolean
  error?: string | null
  onCancel: () => void
  onConfirm: () => void
}

/** Shared destructive-action gate for documents and presentations. */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  pending = false,
  error = null,
  onCancel,
  onConfirm
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="modal modal--sm"
      aria-label={title}
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
          <h2 className="text-[17px] font-semibold text-[var(--ink)]">{title}</h2>
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

        <div className="px-6 pb-5 text-sm text-[var(--ink-secondary)]">
          {children}
          {error && (
            <p className="mt-3 text-[var(--danger)]" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-6 py-4">
          <button type="button" className="btn btn-ghost w-auto" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary w-auto"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending && <span className="spinner" aria-hidden="true" />}
            {pending ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
