import type { ReactNode } from 'react'

/** Signed-out shell: one centered column on a quiet, hairlined canvas. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-canvas">
      <div className="auth-panel stagger">{children}</div>
    </div>
  )
}
