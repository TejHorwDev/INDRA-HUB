import type { ReactNode } from 'react'

interface PageProps {
  title: string
  description?: string
  actions?: ReactNode
  /** Section tabs rendered between the header and the content rule. */
  tabs?: ReactNode
  children: ReactNode
}

/** Shared page frame so every shell screen lines up on the same rhythm. */
export default function Page({ title, description, actions, tabs, children }: PageProps) {
  return (
    <div className="page-frame">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{title}</h1>
          {description && <p className="page-description">{description}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>

      {tabs && <div className="page-tabs">{tabs}</div>}

      {/*
        * No rule under the header when there are no tabs: the heading and the
        * content are one block, separated by space. The tabs bring their own
        * line, which is the only reason one is ever needed here.
        */}
      <div className={tabs ? 'pt-5' : 'pt-5'}>{children}</div>
    </div>
  )
}
