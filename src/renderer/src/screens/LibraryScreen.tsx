import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LibraryItem } from '@shared/types'
import EmptyState from '../components/EmptyState'
import Page from '../components/Page'
import { useToast } from '../components/ToastProvider'
import {
  ChevronRightIcon,
  FileIcon,
  PlusIcon,
  PresentationIcon,
  SearchIcon
} from '../components/icons'
import { api, errorMessage } from '../lib/api'
import { useConnectivity } from '../lib/connectivity'
import { formatRelative } from '../lib/format'

interface LibraryScreenProps {
  kind: 'documents' | 'presentations'
}

/**
 * The offline library.
 *
 * With no route out the workspace narrows to the two things that were always
 * local — a document and a deck — and this is where they are. One list, every
 * project, most recently touched first, with the project named on each row so
 * nothing is hidden behind a container the user has to remember.
 *
 * It is the offline workspace, and only the offline workspace: online, a
 * project is the container, and /documents redirects to the project list. The
 * cloud shelf that briefly lived here moved to Projects for the same reason.
 */
export default function LibraryScreen({ kind }: LibraryScreenProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const { offline } = useConnectivity()

  const [items, setItems] = useState<LibraryItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const isDocument = kind === 'documents'

  const load = useCallback(async () => {
    try {
      const snapshot = await api.library.snapshot()
      setItems(isDocument ? snapshot.documents : snapshot.presentations)
      setError(null)
    } catch (failure) {
      setError(errorMessage(failure))
      setItems([])
    }
  }, [isDocument])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    if (!items) return null
    const needle = query.trim().toLowerCase()
    if (!needle) return items
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(needle) ||
        item.projectName.toLowerCase().includes(needle)
    )
  }, [items, query])

  async function create(): Promise<void> {
    if (creating) return
    setCreating(true)
    try {
      // A document needs a project. Offline that is the most recent one on
      // this PC, or a first project if the machine has never had one.
      const projects = await api.projects.list()
      const project = projects[0] ?? (await api.projects.create({ name: 'My work' }))

      if (isDocument) {
        const document = await api.documents.create(project.id, 'Untitled document')
        navigate(`/project/${project.id}/documents/${document.id}`)
      } else {
        const presentation = await api.presentations.create(project.id, 'Untitled presentation')
        navigate(`/project/${project.id}/presentations/${presentation.id}`)
      }
    } catch (failure) {
      toast.error(errorMessage(failure))
      setCreating(false)
    }
  }

  function open(item: LibraryItem): void {
    navigate(
      isDocument
        ? `/project/${item.projectId}/documents/${item.id}`
        : `/project/${item.projectId}/presentations/${item.id}`
    )
  }

  return (
    <Page
      title={isDocument ? 'Documents' : 'Presentations'}
      actions={
        <button
          type="button"
          className="btn btn-primary w-auto"
          onClick={() => void create()}
          disabled={creating}
        >
          {creating ? <span className="spinner" aria-hidden="true" /> : <PlusIcon size={14} />}
          {isDocument ? 'New document' : 'New presentation'}
        </button>
      }
    >
      {offline && (
        <p className="library-note">
          Working offline. Everything here is on this PC and saves here.
        </p>
      )}

      {items && items.length > 6 && (
        <div className="member-search library-search">
          <SearchIcon size={14} className="member-search-icon" />
          <input
            className="field-input member-search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={isDocument ? 'Search documents' : 'Search presentations'}
            aria-label={isDocument ? 'Search documents' : 'Search presentations'}
            spellCheck={false}
          />
        </div>
      )}

      {error && (
        <p className="home-error" role="alert">
          {error}
        </p>
      )}

      {visible === null ? (
        <ul className="project-list project-list-skeleton" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <li key={index} className="skeleton skeleton-row" />
          ))}
        </ul>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={isDocument ? <FileIcon size={18} /> : <PresentationIcon size={18} />}
          title={query ? 'Nothing matches' : isDocument ? 'No documents yet' : 'No decks yet'}
          description={
            query
              ? 'Try a different word.'
              : isDocument
                ? 'Start writing — it saves on this PC as you go.'
                : 'Start a deck — it saves on this PC as you go.'
          }
          action={
            query ? undefined : (
              <button
                type="button"
                className="btn btn-primary w-auto"
                onClick={() => void create()}
                disabled={creating}
              >
                {isDocument ? 'New document' : 'New presentation'}
              </button>
            )
          }
        />
      ) : (
        <div className="data-list data-list--library">
          <div className="data-head" aria-hidden="true">
            <span>{isDocument ? 'Document' : 'Presentation'}</span>
            <span>Project</span>
            <span>Updated</span>
            <span />
          </div>
          <ul className="data-body">
            {visible.map((item) => (
              <li key={item.id} className="data-row">
                <button type="button" className="data-open" onClick={() => open(item)}>
                  <span className="data-mark" aria-hidden="true">
                    {isDocument ? <FileIcon size={15} /> : <PresentationIcon size={15} />}
                  </span>
                  <span className="data-main">
                    <span className="data-name">{item.title}</span>
                    {typeof item.slideCount === 'number' && (
                      <span className="data-sub">
                        {item.slideCount} {item.slideCount === 1 ? 'slide' : 'slides'}
                      </span>
                    )}
                  </span>
                </button>

                <span className="data-cell data-cell--truncate" title={item.projectName}>
                  {item.projectName}
                </span>
                <span className="data-cell">{formatRelative(item.updatedAt)}</span>

                <ChevronRightIcon size={15} className="project-row-chevron" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Page>
  )
}
