import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  CloudProjectSummary,
  OfflineWorkSummary,
  ProjectDetail,
  ProjectSummary
} from '@shared/types'
import EmptyState from '../components/EmptyState'
import NewProjectModal from '../components/NewProjectModal'
import Page from '../components/Page'
import ProjectCard from '../components/ProjectCard'
import { useToast } from '../components/ToastProvider'
import { AlertCircleIcon, ChevronRightIcon, CloudIcon, FolderIcon, PlusIcon } from '../components/icons'
import { api, errorMessage } from '../lib/api'
import { useConnectivity } from '../lib/connectivity'
import { formatRelative } from '../lib/format'
import { useSession } from '../lib/session'

export default function DashboardScreen() {
  const navigate = useNavigate()
  const toast = useToast()
  const { offline } = useConnectivity()
  const { user } = useSession()

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [importing, setImporting] = useState(false)

  /*
   * The cloud copies belong here: a project is the container, so this is where
   * a project that is not on this PC yet should be offered. Offline the list is
   * not fetched and not shown — the cloud is never part of the offline picture.
   */
  const [cloudItems, setCloudItems] = useState<CloudProjectSummary[] | null>(null)
  const [pulling, setPulling] = useState<string | null>(null)

  /* Work written in the offline workspace, waiting to be adopted. */
  const [offlineWork, setOfflineWork] = useState<OfflineWorkSummary | null>(null)
  const [claiming, setClaiming] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    setProjects(null)
    try {
      setProjects(await api.projects.list())
    } catch (failure) {
      setError(errorMessage(failure))
      setProjects([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (offline || user?.mode === 'offline') {
      setOfflineWork(null)
      return
    }
    let cancelled = false
    void api.offline
      .summary()
      .then((summary) => {
        if (!cancelled) setOfflineWork(summary.projects > 0 ? summary : null)
      })
      .catch(() => {
        if (!cancelled) setOfflineWork(null)
      })
    return () => {
      cancelled = true
    }
  }, [offline, user])

  async function claimOffline(): Promise<void> {
    if (claiming) return
    setClaiming(true)
    try {
      await api.offline.claim()
      setOfflineWork(null)
      await load()
      toast.success('Offline work moved into your account.')
    } catch (failure) {
      toast.error(errorMessage(failure))
    } finally {
      setClaiming(false)
    }
  }

  useEffect(() => {
    if (offline) {
      setCloudItems(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const state = await api.cloud.state()
        if (!state.linked) {
          if (!cancelled) setCloudItems([])
          return
        }
        const list = await api.cloud.list()
        if (!cancelled) setCloudItems(list)
      } catch {
        // A cloud that cannot answer says nothing: the projects on this PC are
        // unaffected, and a banner about a backup would be noise.
        if (!cancelled) setCloudItems([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [offline])

  /** A cloud copy opens where it is, or is brought down first. */
  async function openCloud(entry: CloudProjectSummary): Promise<void> {
    if (pulling) return
    if (entry.localProjectId) {
      navigate(`/project/${entry.localProjectId}`)
      return
    }
    setPulling(entry.cloudId)
    try {
      const project = await api.cloud.pull(entry.cloudId)
      toast.success(`Opened ${project.name} on this PC.`)
      navigate(`/project/${project.id}`)
    } catch (failure) {
      toast.error(errorMessage(failure))
    } finally {
      setPulling(null)
    }
  }

  /* A project that was written to a file elsewhere comes back as a new one. */
  async function openSaved(): Promise<void> {
    if (importing) return
    setImporting(true)
    try {
      const result = await api.projects.importFile()
      if (result) {
        toast.success(`Opened ${result.fileName}.`)
        navigate(`/project/${result.project.id}`)
      }
    } catch (failure) {
      toast.error(errorMessage(failure))
    } finally {
      setImporting(false)
    }
  }

  function handleCreated(project: ProjectDetail) {
    setModalOpen(false)
    toast.success(`“${project.name}” created.`)
    navigate(`/project/${project.id}`)
  }

  return (
    <>
      <Page
        eyebrow="Workspace"
        title="Projects"
        description="Every project on this PC, plus the copies saved to your account."
        actions={
          <div className="flex flex-none items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost w-auto"
              onClick={() => void openSaved()}
              disabled={importing}
              title="Open a project from a .indrahub file"
            >
              {importing ? <span className="spinner" aria-hidden="true" /> : <FolderIcon size={14} />}
              Open a saved project
            </button>
            <button
              type="button"
              className="btn btn-primary w-auto flex-none"
              onClick={() => setModalOpen(true)}
            >
              <PlusIcon size={15} />
              New project
            </button>
          </div>
        }
      >
        {offlineWork && (
          <div className="offline-work-card">
            <div className="min-w-0">
              <p className="offline-work-title">
                {offlineWork.projects} {offlineWork.projects === 1 ? 'project' : 'projects'} written
                offline
              </p>
              <p className="offline-work-note">
                Saved on this PC while nobody was signed in. Bring{' '}
                {offlineWork.projects === 1 ? 'it' : 'them'} into your account and they appear
                everywhere you sign in.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost w-auto flex-none"
              onClick={() => void claimOffline()}
              disabled={claiming}
            >
              {claiming ? <span className="spinner" aria-hidden="true" /> : null}
              Move into my account
            </button>
          </div>
        )}

        {error ? (
          <EmptyState
            icon={<AlertCircleIcon size={18} />}
            title="Couldn’t load your projects"
            description={error}
            action={
              <button type="button" className="btn btn-ghost w-auto" onClick={() => void load()}>
                Try again
              </button>
            }
          />
        ) : projects === null ? (
          <div className="project-list-skeleton" aria-busy="true" aria-label="Loading projects">
            {[0, 1, 2].map((index) => (
              <span key={index} className="skeleton" style={{ height: 74, borderRadius: 8 }} />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={<FolderIcon size={18} />}
            title="No projects yet"
            description="A new project starts completely blank — just a name, and you as its head developer."
            action={
              <button
                type="button"
                className="btn btn-primary w-auto"
                onClick={() => setModalOpen(true)}
              >
                <PlusIcon size={15} />
                Create a project
              </button>
            }
          />
        ) : (
          <ul className="project-list">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={() => navigate(`/project/${project.id}`)}
              />
            ))}
          </ul>
        )}

        {!offline && cloudItems && cloudItems.length > 0 && (
          <section className="cloud-shelf" aria-label="In the cloud">
            <div className="home-section-head home-section-head--rule">
              <span className="home-section-title">In the cloud</span>
              <span className="home-count">{cloudItems.length}</span>
            </div>
            <ul className="project-list">
              {cloudItems.map((entry) => (
                <li key={entry.cloudId}>
                  <button
                    type="button"
                    className="project-row project-row--inline"
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

      <NewProjectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
      />
    </>
  )
}
