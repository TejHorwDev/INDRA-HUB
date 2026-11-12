import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ProjectDetail } from '@shared/types'
import { ApiError, api, errorMessage } from '../lib/api'
import TextField from './TextField'
import { XIcon } from './icons'

interface NewProjectModalProps {
  open: boolean
  onClose: () => void
  onCreated: (project: ProjectDetail) => void
}

const MAX_DESCRIPTION = 280

export default function NewProjectModal({ open, onClose, onCreated }: NewProjectModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const descriptionId = useId()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [touched, setTouched] = useState(false)
  const [creating, setCreating] = useState(false)
  const [serverError, setServerError] = useState<{ field?: string; message: string } | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (!open) return
    setName('')
    setDescription('')
    setTouched(false)
    setCreating(false)
    setServerError(null)
    const timer = window.setTimeout(() => nameRef.current?.focus(), 60)
    return () => window.clearTimeout(timer)
  }, [open])

  const nameError =
    touched && !name.trim()
      ? 'Give the project a name.'
      : serverError?.field === 'name'
        ? serverError.message
        : null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (creating) return

    setTouched(true)
    setServerError(null)
    if (!name.trim()) {
      nameRef.current?.focus()
      return
    }

    setCreating(true)
    try {
      const project = await api.projects.create({
        name: name.trim(),
        description: description.trim()
      })
      onCreated(project)
    } catch (error) {
      setServerError({
        field: error instanceof ApiError ? error.field : undefined,
        message: errorMessage(error)
      })
      setCreating(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby="new-project-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!creating) onClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && !creating) onClose()
      }}
    >
      <form className="modal-panel" onSubmit={handleSubmit} noValidate>
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <div>
            <h2 id="new-project-title" className="text-[17px] font-semibold text-[var(--ink)]">
              New project
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-tertiary)]">
              Starts blank. You become its head developer.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
            disabled={creating}
          >
            <XIcon size={15} />
          </button>
        </div>

        <div className="space-y-4 px-6 pb-5">
          <TextField
            ref={nameRef}
            label="Project name"
            name="projectName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={nameError}
            placeholder="e.g. Indra web app"
            spellCheck={false}
            maxLength={80}
            disabled={creating}
          />

          <div>
            <div className="field-label">
              <label htmlFor={descriptionId}>Description (optional)</label>
              <span className="text-[var(--ink-tertiary)]">
                {description.length}/{MAX_DESCRIPTION}
              </span>
            </div>
            <textarea
              id={descriptionId}
              className="field-textarea"
              value={description}
              onChange={(event) => setDescription(event.target.value.slice(0, MAX_DESCRIPTION))}
              placeholder="What is this project for?"
              rows={3}
              maxLength={MAX_DESCRIPTION}
              disabled={creating}
            />
          </div>
        </div>

        {serverError && !serverError.field && (
          <p className="px-6 pb-4 text-sm text-[var(--danger)]" role="alert">
            {serverError.message}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-6 py-4">
          <button
            type="button"
            className="btn btn-ghost w-auto"
            onClick={onClose}
            disabled={creating}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-primary w-auto" disabled={creating}>
            {creating && <span className="spinner" aria-hidden="true" />}
            {creating ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
