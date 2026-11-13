import type { ProjectSummary } from '@shared/types'
import { formatRelative } from '../lib/format'
import { FolderIcon } from './icons'

interface ProjectCardProps {
  project: ProjectSummary
  onOpen: () => void
}

/**
 * One project, as a card with a lid.
 *
 * The band at the top is the card's face: the mark, and the role this person
 * has in the project, stated once instead of as a badge beside the name. The
 * name is display size because it is the thing being chosen; the facts are
 * real ones — role, team size, last change.
 */
export default function ProjectCard({ project, onOpen }: ProjectCardProps) {
  const teamSize = project.memberCount + 1
  const role =
    project.role === 'owner'
      ? 'Head developer'
      : project.via === 'team'
        ? 'Team project'
        : project.via === 'invite'
          ? 'Invited'
          : 'Project'

  return (
    <li>
      <button type="button" className="project-row" onClick={onOpen}>
        <span className="project-visual" aria-hidden="true">
          <span className="project-visual-mark">
            <FolderIcon size={17} />
          </span>
          <span className="project-visual-meta">{role}</span>
        </span>

        <span className="project-row-body">
          <span className="project-row-name">{project.name}</span>

          {project.description && <span className="project-row-desc">{project.description}</span>}

          <span className="project-row-meta">
            <span>
              {teamSize} {teamSize === 1 ? 'member' : 'members'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatRelative(project.updatedAt)}</span>
          </span>
        </span>
      </button>
    </li>
  )
}
