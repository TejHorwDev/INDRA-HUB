import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CloudProjectSummary, LibraryItem } from '@shared/types'
import EmptyState from '../components/EmptyState'
import Page from '../components/Page'
import { useToast } from '../components/ToastProvider'
import {
  ChevronRightIcon,
  CloudIcon,
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
 * The same list is worth having online: it is the quickest way back into
 * something you were writing, without finding the project first.
 */
export default function LibraryScreen({ kind }: LibraryScreenProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const { offline } = useConnectivity()

  const [items, setItems] = useState<LibraryItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  /*
   * The cloud copies. They are a separate list on purpose: they live in the
   * account's own database, not on this disk, and the moment the machine has
   * no route out they are neither fetched nor shown. Offline is this PC only.
   */
  const [cloudItems, setCloudItems] = useState<CloudProjectSummary[] | null>(null)
  const [pulling, setPulling] = useState<string | null>(null)

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

  useEffect(() => {
    if (offline) {
      setCloudItems(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const state = await api.cloud.state()
        if (cancelled || !state.linked) {
          if (!cancelled) setCloudItems([])
          return
        }
        const list = await api.cloud.list()
        if (!cancelled) setCloudItems(list)
      } catch {
        // A cloud that cannot answer is not an error the library should shout
        // about: the work on this PC is unaffected.
        if (!cancelled) setCloudItems([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [offline])

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

  /**
   * A cloud row opens the local copy when this PC already has one; otherwise it
   * is brought down first. Either way the user lands in the same place: a
   * project they can work on.
   */
  async function openCloud(entry: CloudProjectSummary): Promise<void> {
    if (pulling) return
    if (entry.localProjectId) {
      navigate(`/project/${entry.localProjectId}`)
      return
    }
    setPulling(entry.cloudId)
    try {
      const project = await api.cloud.pull(entry.cloudId)
      setCloudItems((current) =>
        (current ?? []).map((item) =>
          item.cloudId === entry.cloudId ? { ...item, localProjectId: project.id } : item
        )
      )
      toast.success(`Opened ${project.name} on this PC.`)
      navigate(`/project/${project.id}`)
    } catch (failure) {
      toast.error(errorMessage(failure))
    } finally {
      setPulling(null)
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
        <ul className="project-list">
          {visible.map((item) => (
            <li key={item.id}>
              <button type="button" className="project-row" onClick={() => open(item)}>
                <span className="library-icon" aria-hidden="true">
                  {isDocument ? <FileIcon size={16} /> : <PresentationIcon size={16} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="project-row-name">{item.title}</span>
                  <span className="project-row-meta">
                    <span>{item.projectName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatRelative(item.updatedAt)}</span>
                    {typeof item.slideCount === 'number' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {item.slideCount} {item.slideCount === 1 ? 'slide' : 'slides'}
                        </span>
                      </>
                    )}
                  </span>
                </span>
                <ChevronRightIcon size={15} className="project-row-chevron" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!offline && cloudItems && cloudItems.length > 0 && (
        <section className="library-cloud" aria-label="In the cloud">
          <div className="home-section-head">
            <span className="home-section-title">In the cloud</span>
            <span className="home-count">{cloudItems.length}</span>
          </div>
          <ul className="project-list">
            {cloudItems.map((entry) => (
              <li key={entry.cloudId}>
                <button
                  type="button"
                  className="project-row"
                  onClick={() => void openCloud(entry)}
                  disabled={pulling !== null}
                >
                  <span className="library-icon" aria-hidden="true">
                    {pulling === entry.cloudId ? (
                      <span className="spinner" />
                    ) : (
                      <CloudIcon size={16} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="project-row-name">{entry.name}</span>
                    <span className="project-row-meta">
                      <span>Cloud</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatRelative(entry.updatedAt)}</span>
                      {!entry.localProjectId && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Not on this PC</span>
                        </>
                      )}
                    </span>
                  </span>
                  <ChevronRightIcon size={15} className="project-row-chevron" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  )
}
