'use client'

import { useEffect, useState } from 'react'

/*
 * The floor of the panel.
 *
 * A ticking clock is the smallest possible proof that this page is live and not a
 * screenshot of a page — which, on a dashboard nobody refreshes, is worth the twelve
 * lines it costs. UTC, because the container is UTC and the logs are UTC and a second
 * clock that disagrees with the logs is worse than none.
 */
export default function Footer(): React.JSX.Element {
  const [now, setNow] = useState<string | null>(null)

  useEffect(() => {
    function tick(): void {
      const stamp = new Date().toISOString().slice(11, 19)
      setNow(`${stamp} UTC`)
    }

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <footer className="foot">
      <span className="foot-brand">control panel</span>
      <span className="foot-live">
        <i />
        <span className="mono" suppressHydrationWarning>
          {now ?? '—'}
        </span>
      </span>
      <button
        type="button"
        className="row-action"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      >
        Back to top
      </button>
    </footer>
  )
}
