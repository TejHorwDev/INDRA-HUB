import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
  /** `page` is a bordered card; `panel` fills a panel or section. */
  variant?: 'page' | 'panel'
}

/**
 * One emptiness language for the whole app: same icon tile, same title and
 * description rhythm, optional single action.
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'page'
}: EmptyStateProps) {
  return (
    <div className={variant === 'panel' ? 'empty-state empty-state--panel' : 'empty-state'}>
      <span className="empty-state-icon">{icon}</span>
      <h2 className="empty-state-title">{title}</h2>
      <p className="empty-state-description">{description}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}
