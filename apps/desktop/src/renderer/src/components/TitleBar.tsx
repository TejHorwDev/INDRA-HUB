import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import { CloudOffIcon, MaximizeIcon, MinusIcon, RestoreIcon, SearchIcon, XIcon } from './icons'
import { useConnectivity } from '../lib/connectivity'

interface TitleBarProps {
  /** Current view, shown next to the wordmark. */
  label: string
  /** The palette is part of the app shell, not the signed-out screens. */
  showSearch: boolean
  onOpenPalette: () => void
}

export default function TitleBar({ label, showSearch, onOpenPalette }: TitleBarProps) {
  const bridge = window.indra
  const { offline } = useConnectivity()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!bridge) return
    let active = true

    bridge.window
      .isMaximized()
      .then((value) => {
        if (active) setMaximized(value)
      })
      .catch(() => {
        // Window state is cosmetic; a failure just leaves the default icon.
      })

    const stopListening = bridge.window.onMaximizedChange(setMaximized)
    return () => {
      active = false
      stopListening()
    }
  }, [bridge])

  /*
   * The bar is the window's caption: double-clicking anywhere on it maximises
   * or restores, which is what every Windows title bar does. Clicks that
   * started on a control are left alone.
   */
  function handleDoubleClick(event: MouseEvent<HTMLElement>): void {
    if ((event.target as HTMLElement).closest('button, a, input')) return
    void bridge?.window.toggleMaximize()
  }

  return (
    <header className="titlebar" onDoubleClick={handleDoubleClick}>
      <div className="brand">
        <span className="brand-name">Indra Hub</span>
        <span className="brand-sep" aria-hidden="true" />
        {/* Keyed so the name of the view fades over as the view changes. */}
        <span key={label} className="titlebar-label">
          {label}
        </span>
        {offline && (
          <span className="offline-pill" title="No internet connection on this PC">
            <CloudOffIcon size={12} />
            Offline
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 justify-center px-4">
        {showSearch && (
          <button
            type="button"
            className="search-trigger"
            onClick={onOpenPalette}
            aria-label="Search or jump to"
          >
            <SearchIcon size={14} className="search-icon" />
            <span className="search-trigger-label">Search or jump to…</span>
            <span className="kbd" aria-hidden="true">
              Ctrl K
            </span>
          </button>
        )}
      </div>

      <div className="no-drag flex flex-none items-center">
        <div className="window-controls">
          <button
            type="button"
            className="window-control"
            onClick={() => bridge?.window.minimize()}
            aria-label="Minimize window"
            title="Minimize"
          >
            <MinusIcon size={10} />
          </button>
          <button
            type="button"
            className="window-control"
            onClick={() => bridge?.window.toggleMaximize()}
            aria-label={maximized ? 'Restore window' : 'Maximize window'}
            title={maximized ? 'Restore' : 'Maximize'}
          >
            {maximized ? <RestoreIcon size={10} /> : <MaximizeIcon size={10} />}
          </button>
          <button
            type="button"
            className="window-control window-control--close"
            onClick={() => bridge?.window.close()}
            aria-label="Close window"
            title="Close"
          >
            <XIcon size={11} />
          </button>
        </div>
      </div>
    </header>
  )
}
