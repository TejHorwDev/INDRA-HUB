import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

/** Sidebar + scrolling content area. The title bar is owned by App. */
export default function AppShell() {
  return (
    <div className="flex h-full min-h-0">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
