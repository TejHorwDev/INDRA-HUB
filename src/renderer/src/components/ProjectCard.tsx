import type { ProjectSummary } from '@shared/types'
import { formatRelative } from '../lib/format'
import { ChevronRightIcon, FolderIcon } from './icons'

interface ProjectCardProps {
  project: ProjectSummary
  onOpen: () => void
}

/** One row in the project list — real data only: role, team size, last change. */
export default function ProjectCard({ project, onOpen }: ProjectCardProps) {
  const teamSize = project.memberCount + 1

  return (
    <li>
      <button type="button" className="project-row" onClick={onOpen}>
        {/* A glyph to scan by: the same mark on every card, so the eye lands on
            the names instead of reading the list twice. */}
        <span className="project-row-mark" aria-hidden="true">
          <FolderIcon size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="project-row-name">{project.name}</span>
            {project.role === 'owner' && <span className="badge badge--accent">Head developer</span>}
            {project.via === 'team' && <span className="badge">Team</span>}
            {project.via === 'invite' && <span className="badge">Invited</span>}
          </span>

          {project.description && <span className="project-row-desc">{project.description}</span>}

          <span className="project-row-meta">
            <span>
              {teamSize} {teamSize === 1 ? 'member' : 'members'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatRelative(project.updatedAt)}</span>
          </span>
        </span>

        <ChevronRightIcon size={15} className="project-row-chevron" />
      </button>
    </li>
  )
}
