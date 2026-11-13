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
    <div className="mx-auto w-full max-w-[1060px] px-8 pt-8 pb-12">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{title}</h1>
          {description && <p className="page-description">{description}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>

      {tabs && <div className="page-tabs">{tabs}</div>}

      <div className={tabs ? 'pt-6' : 'border-t border-[var(--line)] pt-6'}>{children}</div>
    </div>
  )
}
