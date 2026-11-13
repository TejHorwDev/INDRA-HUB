import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { DocumentSummary } from '@shared/types'
import ConfirmDialog from '../components/ConfirmDialog'
import EmptyState from '../components/EmptyState'
import Page from '../components/Page'
import ProjectTabs from '../components/ProjectTabs'
import { useToast } from '../components/ToastProvider'
import { AlertCircleIcon, FileIcon, PlusIcon, SearchIcon } from '../components/icons'
import { api, errorMessage } from '../lib/api'
import { formatDate, formatRelative } from '../lib/format'

type Sort = 'updated' | 'title'

export default function DocumentsScreen() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()

  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('updated')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<DocumentSummary | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setDocuments(await api.documents.list(projectId))
    } catch (failure) {
      setError(errorMessage(failure))
      setDocuments([])
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    if (!documents) return null
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? documents.filter((document) => document.title.toLowerCase().includes(needle))
      : documents
    return [...filtered].sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }, [documents, query, sort])

  async function createDocument() {
    setCreating(true)
    try {
      const document = await api.documents.create(projectId, 'Untitled document')
      toast.success('Document created.')
      navigate(`/project/${projectId}/documents/${document.id}`)
    } catch (failure) {
      toast.error(errorMessage(failure))
      setCreating(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      await api.documents.remove(projectId, deleting.id)
      setDocuments((current) => current?.filter((entry) => entry.id !== deleting.id) ?? null)
      toast.success('Document deleted.')
      setDeleting(null)
    } catch (failure) {
      toast.error(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Page
        title="Documents"
        tabs={<ProjectTabs projectId={projectId} />}
        actions={
          <button
            type="button"
            className="btn btn-primary w-auto"
            onClick={() => void createDocument()}
            disabled={creating}
          >
            {creating ? <span className="spinner" aria-hidden="true" /> : <PlusIcon size={15} />}
            {creating ? 'Creating…' : 'New document'}
          </button>
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
              placeholder="Search documents"
              aria-label="Search documents"
              style={{ paddingRight: 28 }}
            />
          </div>

          <label className="toolbar-field">
            <span>Sort</span>
            <select
              className="select-input"
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
            >
              <option value="updated">Last updated</option>
              <option value="title">Title</option>
            </select>
          </label>
        </div>

        {error ? (
          <EmptyState
            icon={<AlertCircleIcon size={18} />}
            title="Couldn’t load documents"
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
            icon={<FileIcon size={18} />}
            title={query ? 'No matching documents' : 'No documents yet'}
            description={
              query
                ? `Nothing matches “${query}”.`
                : 'Write research, notes or reports — then turn any of them into a presentation.'
            }
            action={
              query ? undefined : (
                <button
                  type="button"
                  className="btn btn-primary w-auto"
                  onClick={() => void createDocument()}
                >
                  <PlusIcon size={15} />
                  Create a document
                </button>
              )
            }
          />
        ) : (
          <ul className="project-list">
            {visible.map((document) => (
              <li key={document.id}>
                <div className="project-row project-row--split">
                  <button
                    type="button"
                    className="project-row-main"
                    onClick={() => navigate(`/project/${projectId}/documents/${document.id}`)}
                  >
                    <span className="doc-glyph">
                      <FileIcon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="project-row-name">{document.title}</span>
                      <span className="project-row-meta">
                        {/* Who touched it last is the useful fact on a shared
                            project; who wrote the first draft is a tooltip. */}
                        <span title={`Created by ${document.createdBy.displayName}`}>
                          {document.updatedBy &&
                          document.updatedBy.displayName !== document.createdBy.displayName
                            ? `Edited by ${document.updatedBy.displayName}`
                            : document.createdBy.displayName}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{formatRelative(document.updatedAt)}</span>
                        <span aria-hidden="true">·</span>
                        <span>v{document.version}</span>
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm w-auto"
                    onClick={() => setDeleting(document)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Page>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete document"
        confirmLabel="Delete"
        pending={busy}
        onCancel={() => {
          if (!busy) setDeleting(null)
        }}
        onConfirm={() => void confirmDelete()}
      >
        “{deleting?.title}” and its version history will be removed. Presentations generated from it
        stay in the project, but lose their source link. Last updated{' '}
        {deleting ? formatDate(deleting.updatedAt) : ''}.
      </ConfirmDialog>
    </>
  )
}
