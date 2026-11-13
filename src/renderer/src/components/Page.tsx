import type { ReactNode } from 'react'

interface PageProps {
  title: string
  /** The small line above the title: where this page sits in the app. */
  eyebrow?: string
  description?: string
  actions?: ReactNode
  /** Section tabs rendered between the masthead and the content. */
  tabs?: ReactNode
  children: ReactNode
}

/**
 * The masthead.
 *
 * A page starts the same way everywhere: a label for the part of the app you
 * are in, the page name at display size, one sentence about what is here, and
 * the actions that belong to the whole page on the right. Everything below is
 * content, and content never has to invent its own heading rhythm.
 */
export default function Page({ title, eyebrow, description, actions, tabs, children }: PageProps) {
  return (
    <div className="page-frame">
      <header className="masthead">
        <div className="masthead-text">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1 className="page-title">{title}</h1>
          {description && <p className="page-description">{description}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>

      {tabs && <div className="page-tabs">{tabs}</div>}

      <div className="page-content">{children}</div>
    </div>
  )
}
