import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import TextField from './TextField'

interface PromptDialogProps {
  open: boolean
  title: string
  label: string
  description?: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  onCancel: () => void
  onSubmit: (value: string) => void
}

/**
 * A real input dialog.
 *
 * This replaces `window.prompt`, which Electron does not implement — the
 * toolbar's Link and Image buttons used to open a prompt that never appeared,
 * so they did nothing at all. A `<dialog>` also means the value can be
 * validated before it reaches a document.
 */
export default function PromptDialog({
  open,
  title,
  label,
  description,
  initialValue = '',
  placeholder,
  confirmLabel = 'Insert',
  onCancel,
  onSubmit
}: PromptDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (!open) return
    setValue(initialValue)
    setError(null)
  }, [open, initialValue])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Enter a URL.')
      return
    }
    // http(s) only: this value is written into a document and later rendered.
    if (!/^https?:\/\/[^\s]+$/i.test(trimmed)) {
      setError('Enter a full address starting with http:// or https://.')
      return
    }
    setError(null)
    onSubmit(trimmed)
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby="prompt-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onCancel()
      }}
    >
      <form className="modal-panel" onSubmit={submit} noValidate>
        <div className="px-6 pt-5 pb-4">
          <h2 id="prompt-dialog-title" className="text-[17px] font-semibold text-[var(--ink)]">
            {title}
          </h2>
          {description && <p className="mt-2 text-[var(--fs-sm)] text-[var(--ink-tertiary)]">{description}</p>}
        </div>

        <div className="px-6 pb-4">
          <TextField
            label={label}
            name="prompt-value"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder ?? 'https://'}
            error={error}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="flex items-center justify-end gap-2 px-6 pb-5">
          <button type="button" className="btn btn-ghost w-auto" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary w-auto">
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}
