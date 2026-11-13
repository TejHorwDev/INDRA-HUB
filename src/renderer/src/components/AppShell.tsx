import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'

/** Sidebar + scrolling content area. The title bar is owned by App. */
export default function AppShell() {
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)

  /*
   * A new screen starts at the top. Without this a short page inherits the
   * scroll offset of the long one before it, which reads as a bug.
   */
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [pathname])

  return (
    <div className="flex h-full min-h-0">
      <Sidebar />
      <main ref={mainRef} className="shell-main min-w-0 flex-1 overflow-y-auto">
        {/* Keyed on the route, so the entrance animation replays on arrival. */}
        <div key={pathname} className="page-enter">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
