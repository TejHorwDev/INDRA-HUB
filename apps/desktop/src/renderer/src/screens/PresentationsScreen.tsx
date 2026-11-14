import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { DocumentSummary, PresentationSummary } from '@shared/types'
import ConfirmDialog from '../components/ConfirmDialog'
import EmptyState from '../components/EmptyState'
import Page from '../components/Page'
import ProjectTabs from '../components/ProjectTabs'
import { useToast } from '../components/ToastProvider'
import {
  AlertCircleIcon,
  ChevronLeftIcon,
  PlusIcon,
  SearchIcon,
  SquareIcon
} from '../components/icons'
import { api, errorMessage } from '../lib/api'
import { formatRelative } from '../lib/format'

export default function PresentationsScreen() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()

  const [presentations, setPresentations] = useState<PresentationSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<PresentationSummary | null>(null)
  const [busy, setBusy] = useState(false)

  const [convertOpen, setConvertOpen] = useState(false)
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const convertRef = useRef<HTMLDialogElement>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setPresentations(await api.presentations.list(projectId))
    } catch (failure) {
      setError(errorMessage(failure))
      setPresentations([])
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const dialog = convertRef.current
    if (!dialog) return
    if (convertOpen && !dialog.open) dialog.showModal()
    if (!convertOpen && dialog.open) dialog.close()
    if (convertOpen && documents === null) {
      api.documents
        .list(projectId)
        .then(setDocuments)
        .catch((failure) => {
          toast.error(errorMessage(failure))
          setDocuments([])
        })
    }
  }, [convertOpen, documents, projectId, toast])

  const visible = useMemo(() => {
    if (!presentations) return null
    const needle = query.trim().toLowerCase()
    return needle
      ? presentations.filter((entry) => entry.title.toLowerCase().includes(needle))
      : presentations
  }, [presentations, query])

  async function createBlank() {
    setCreating(true)
    try {
      const presentation = await api.presentations.create(projectId, 'Untitled presentation')
      navigate(`/project/${projectId}/presentations/${presentation.id}`)
    } catch (failure) {
      toast.error(errorMessage(failure))
      setCreating(false)
    }
  }

  async function convert(document: DocumentSummary) {
    setConvertingId(document.id)
    try {
      const presentation = await api.presentations.convert(projectId, document.id)
      toast.success(`Generated ${presentation.slides.length} slides offline — no AI used.`)
      setConvertOpen(false)
      navigate(`/project/${projectId}/presentations/${presentation.id}`)
    } catch (failure) {
      toast.error(errorMessage(failure))
    } finally {
      setConvertingId(null)
    }
  }

  async function duplicate(presentation: PresentationSummary) {
    try {
      const copy = await api.presentations.duplicate(projectId, presentation.id)
      setPresentations((current) => (current ? [copy, ...current] : [copy]))
      toast.success('Presentation duplicated.')
    } catch (failure) {
      toast.error(errorMessage(failure))
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      await api.presentations.remove(projectId, deleting.id)
      setPresentations((current) => current?.filter((entry) => entry.id !== deleting.id) ?? null)
      setDeleting(null)
      toast.success('Presentation deleted.')
    } catch (failure) {
      toast.error(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Page
        eyebrow="Project"
        title="Presentations"
        description="Decks in this project, built blank or from a document."
        tabs={<ProjectTabs projectId={projectId} />}
        actions={
          <div className="flex flex-none items-center gap-2">
            <button type="button" className="btn btn-ghost w-auto" onClick={() => setConvertOpen(true)}>
              From document
            </button>
            <button
              type="button"
              className="btn btn-primary w-auto"
              onClick={() => void createBlank()}
              disabled={creating}
            >
              {creating ? <span className="spinner" aria-hidden="true" /> : <PlusIcon size={15} />}
              {creating ? 'Creating…' : 'New presentation'}
            </button>
          </div>
        }
      >
        <div className="toolbar-row">
          <div className="search-shell" style={{ maxWidth: 280 }}>
            <SearchIcon size={14} className="search-icon" />
            <input
              type="search"
              className="search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search presentations"
              aria-label="Search presentations"
              style={{ paddingRight: 28 }}
            />
          </div>
          <p className="toolbar-note">
            Deck conversion runs locally — it never needs an AI provider or a connection.
          </p>
        </div>

        {error ? (
          <EmptyState
            icon={<AlertCircleIcon size={18} />}
            title="Couldn’t load presentations"
            description={error}
            action={
              <button type="button" className="btn btn-ghost w-auto" onClick={() => void load()}>
                Try again
              </button>
            }
          />
        ) : visible === null ? (
          <div className="project-list-skeleton" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <span key={index} className="skeleton" style={{ height: 62, borderRadius: 8 }} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<SquareIcon size={18} />}
            title={query ? 'No matching presentations' : 'No presentations yet'}
            description={
              query
                ? `Nothing matches “${query}”.`
                : 'Start from blank, or convert a document into a structured deck in one step.'
            }
            action={
              query ? undefined : (
                <button
                  type="button"
                  className="btn btn-primary w-auto"
                  onClick={() => setConvertOpen(true)}
                >
                  Convert a document
                </button>
              )
            }
          />
        ) : (
          <div className="data-list data-list--decks">
            <div className="data-head" aria-hidden="true">
              <span>Presentation</span>
              <span>Updated</span>
              <span />
            </div>
            <ul className="data-body">
              {visible.map((presentation) => (
                <li key={presentation.id} className="data-row">
                  <button
                    type="button"
                    className="data-open"
                    onClick={() =>
                      navigate(`/project/${projectId}/presentations/${presentation.id}`)
                    }
                  >
                    <span className="data-mark" aria-hidden="true">
                      <SquareIcon size={15} />
                    </span>
                    <span className="data-main">
                      <span className="data-name">
                        {presentation.title}
                        {presentation.stale && <span className="badge badge--warn">Source changed</span>}
                      </span>
                      <span className="data-sub">
                        <span>{presentation.slideCount} slides</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {presentation.conversionMode === 'rule'
                            ? 'Rule-based'
                            : presentation.conversionMode === 'ai'
                              ? 'AI-enhanced'
                              : 'Blank'}
                        </span>
                        {presentation.sourceDocumentTitle && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>from {presentation.sourceDocumentTitle}</span>
                          </>
                        )}
                      </span>
                    </span>
                  </button>

                  <span className="data-cell">{formatRelative(presentation.updatedAt)}</span>

                  <div className="data-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm w-auto"
                      onClick={() => void duplicate(presentation)}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm w-auto"
                      onClick={() => setDeleting(presentation)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Page>

      <dialog
        ref={convertRef}
        className="modal"
        aria-label="Convert a document"
        onCancel={(event) => {
          event.preventDefault()
          setConvertOpen(false)
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setConvertOpen(false)
        }}
      >
        <div className="modal-panel">
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
            <div>
              <h2 className="text-[17px] font-semibold text-[var(--ink)]">Convert a document</h2>
              <p className="mt-1 text-sm text-[var(--ink-tertiary)]">
                Headings become slides, lists become bullets, tables stay tables. Works offline.
              </p>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setConvertOpen(false)}
              aria-label="Close"
            >
              <ChevronLeftIcon size={15} />
            </button>
          </div>

          <div className="px-3 pb-4">
            {documents === null ? (
              <p className="member-hint">Loading documents…</p>
            ) : documents.length === 0 ? (
              <p className="member-hint">
                No documents in this project yet. Create one under Documents first.
              </p>
            ) : (
              <ul className="member-results">
                {documents.map((document) => (
                  <li key={document.id} className="member-result">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-[var(--ink)]">
                        {document.title}
                      </span>
                      <span className="block truncate text-xs text-[var(--ink-tertiary)]">
                        v{document.version} · {formatRelative(document.updatedAt)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm w-auto"
                      onClick={() => void convert(document)}
                      disabled={convertingId !== null}
                    >
                      {convertingId === document.id ? 'Converting…' : 'Convert'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete presentation"
        confirmLabel="Delete"
        pending={busy}
        onCancel={() => {
          if (!busy) setDeleting(null)
        }}
        onConfirm={() => void confirmDelete()}
      >
        “{deleting?.title}” and all of its slides will be removed. The source document is not
        affected.
      </ConfirmDialog>
    </>
  )
}
