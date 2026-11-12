import type { ReactNode } from 'react'
import { InfoIcon } from './icons'

/** Inline, unobtrusive status line — never a top-level banner. */
export default function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="status" aria-live="polite">
      <InfoIcon size={14} />
      <span>{children}</span>
    </div>
  )
}
