import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import Resizer from '../components/Resizer'
import { ChatIcon, ChevronLeftIcon, FileIcon, FolderIcon } from '../components/icons'
import { api } from '../lib/api'

const MIN_LEFT = 184
const MAX_LEFT = 420
const MIN_RIGHT = 232
const MAX_RIGHT = 520
const MIN_CENTER = 280
const DIVIDERS = 12

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

interface PanelSizes {
  left: number
  right: number
}

/** Left first, then right, so the centre panel always keeps its minimum. */
function clampSizes(desired: PanelSizes, total: number): PanelSizes {
  if (total === 0) return desired
  const left = clamp(
    desired.left,
    MIN_LEFT,
    Math.min(MAX_LEFT, total - MIN_RIGHT - MIN_CENTER - DIVIDERS)
  )
  const right = clamp(
    desired.right,
    MIN_RIGHT,
    Math.min(MAX_RIGHT, total - left - MIN_CENTER - DIVIDERS)
  )
  return { left, right }
}

export default function ProjectWorkspaceScreen() {
  const { projectId } = useParams()
  const bodyRef = useRef<HTMLDivElement>(null)

  const [sizes, setSizes] = useState<PanelSizes>({ left: 236, right: 296 })
  const [name, setName] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)

  // The workspace reads the same authorized record as the dashboard.
  useEffect(() => {
    if (!projectId) return
    let active = true
    api.projects
      .get(projectId)
      .then((project) => {
        if (active) setName(project.name)
      })
      .catch(() => {
        if (active) setBlocked(true)
      })
    return () => {
      active = false
    }
  }, [projectId])

  // Keep every panel legal when the window itself is resized.
  useEffect(() => {
    function clampPanels() {
      const total = bodyRef.current?.clientWidth ?? 0
      if (total === 0) return
      setSizes((current) => clampSizes(current, total))
    }

    clampPanels()
    window.addEventListener('resize', clampPanels)
    return () => window.removeEventListener('resize', clampPanels)
  }, [])

  function resizeLeft(delta: number) {
    const total = bodyRef.current?.clientWidth ?? 0
    setSizes((current) => clampSizes({ ...current, left: current.left + delta }, total))
  }

  function resizeRight(delta: number) {
    const total = bodyRef.current?.clientWidth ?? 0
    setSizes((current) => clampSizes({ ...current, right: current.right - delta }, total))
  }

  if (blocked) {
    return (
      <div className="workspace">
        <header className="workspace-header">
          <Link to="/dashboard" className="workspace-back">
            <ChevronLeftIcon size={14} />
            Projects
          </Link>
        </header>
        <EmptyState
          variant="panel"
          icon={<FolderIcon size={15} />}
          title="Project unavailable"
          description="This project was deleted or your account is no longer on its team."
        />
      </div>
    )
  }

  return (
    <div className="workspace">
      <header className="workspace-header">
        <Link to={projectId ? `/project/${projectId}` : '/dashboard'} className="workspace-back">
          <ChevronLeftIcon size={14} />
          Project
        </Link>
        <span className="workspace-sep" aria-hidden="true">
          /
        </span>
        <h1 className="workspace-crumb">{name ?? 'Loading…'}</h1>
        <span className="workspace-note">Editor and files arrive in a later build</span>
      </header>

      <div className="workspace-body" ref={bodyRef}>
        <section className="workspace-panel" style={{ width: sizes.left }} aria-label="Files">
          <div className="panel-head">Files</div>
          <EmptyState
            variant="panel"
            icon={<FolderIcon size={15} />}
            title="No files yet"
            description="Your project's files will appear here."
          />
        </section>

        <Resizer label="Resize file panel" onResize={resizeLeft} />

        <section className="workspace-panel workspace-panel--center" aria-label="Editor">
          <div className="panel-head">Editor</div>
          <EmptyState
            variant="panel"
            icon={<FileIcon size={15} />}
            title="No file open"
            description="Pick a file from the left panel to start editing."
          />
        </section>

        <Resizer label="Resize assistant panel" onResize={resizeRight} />

        <section className="workspace-panel" style={{ width: sizes.right }} aria-label="Assistant">
          <div className="panel-head">Assistant</div>
          <EmptyState
            variant="panel"
            icon={<ChatIcon size={15} />}
            title="Nothing here yet"
            description="AI chat and live preview will live in this panel."
          />
        </section>
      </div>
    </div>
  )
}
