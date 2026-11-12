import { NavLink } from 'react-router-dom'

const TABS = [
  { path: '', label: 'Overview' },
  { path: 'intelligence', label: 'Intelligence' },
  { path: 'documents', label: 'Documents' },
  { path: 'presentations', label: 'Presentations' }
]

/** One project, four connected views — context is never lost. */
export default function ProjectTabs({ projectId }: { projectId: string }) {
  return (
    <nav className="project-tabs" aria-label="Project sections">
      {TABS.map((tab) => (
        <NavLink
          key={tab.path || 'overview'}
          to={tab.path ? `/project/${projectId}/${tab.path}` : `/project/${projectId}`}
          end
          className={({ isActive }) => `project-tab${isActive ? ' project-tab--active' : ''}`}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
