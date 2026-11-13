import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { TeamDetail } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import TextField from './TextField'
import { XIcon } from './icons'

interface TeamNameDialogProps {
  open: boolean
  /** `create` asks for the first name; `rename` starts from the current one. */
  mode: 'create' | 'rename'
  initialName?: string
  onClose: () => void
  onSaved: (team: TeamDetail) => void
}

const MAX_NAME = 60

/** One field, one decision — used for both creating a team and renaming it. */
export default function TeamNameDialog({
  open,
  mode,
  initialName = '',
  onClose,
  onSaved
}: TeamNameDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(initialName)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (!open) return
    setName(initialName)
    setTouched(false)
    setSaving(false)
    setServerError(null)
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 60)
    return () => window.clearTimeout(timer)
  }, [open, initialName])

  const nameError = touched && !name.trim() ? 'Give the team a name.' : serverError

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (saving) return

    setTouched(true)
    setServerError(null)
    if (!name.trim()) {
      inputRef.current?.focus()
      return
    }

    setSaving(true)
    try {
      const team =
        mode === 'create'
          ? await api.team.create({ name: name.trim() })
          : await api.team.rename({ name: name.trim() })
      onSaved(team)
    } catch (error) {
      setServerError(errorMessage(error))
      setSaving(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal modal--sm"
      aria-labelledby="team-name-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!saving) onClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && !saving) onClose()
      }}
    >
      <form className="modal-panel" onSubmit={handleSubmit} noValidate>
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <h2 id="team-name-title" className="text-[17px] font-semibold text-[var(--ink)]">
            {mode === 'create' ? 'Create your team' : 'Rename team'}
          </h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
            disabled={saving}
          >
            <XIcon size={15} />
          </button>
        </div>

        <div className="px-6 pb-5">
          <TextField
            ref={inputRef}
            label="Team name"
            name="teamName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={nameError}
            placeholder="e.g. The studio"
            spellCheck={false}
            maxLength={MAX_NAME}
            disabled={saving}
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-6 py-4">
          <button type="button" className="btn btn-ghost w-auto" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary w-auto"
            disabled={saving || !name.trim()}
          >
            {saving && <span className="spinner" aria-hidden="true" />}
            {mode === 'create' ? 'Create team' : 'Save'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
