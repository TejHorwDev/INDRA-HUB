import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProjectDetail, ProjectSummary } from '@shared/types'
import EmptyState from '../components/EmptyState'
import NewProjectModal from '../components/NewProjectModal'
import Page from '../components/Page'
import ProjectCard from '../components/ProjectCard'
import { useToast } from '../components/ToastProvider'
import { AlertCircleIcon, FolderIcon, PlusIcon } from '../components/icons'
import { api, errorMessage } from '../lib/api'

export default function DashboardScreen() {
  const navigate = useNavigate()
  const toast = useToast()

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [importing, setImporting] = useState(false)

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
        title="Your projects"
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
      </Page>

      <NewProjectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
      />
    </>
  )
}
