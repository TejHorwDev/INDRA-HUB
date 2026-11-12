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
      <header className="flex items-end justify-between gap-6 pb-5">
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          {description && (
            <p className="mt-1.5 text-sm text-[var(--ink-tertiary)]">{description}</p>
          )}
        </div>
        {actions}
      </header>

      {tabs && <div className="page-tabs">{tabs}</div>}

      <div className={tabs ? 'pt-6' : 'border-t border-[var(--line)] pt-6'}>{children}</div>
    </div>
  )
}
