'use client'

import { useEffect, useState } from 'react'

/*
 * One number, counted up.
 *
 * A dashboard that fades in a finished figure is a screenshot. A figure that climbs
 * from zero for half a second is a reading — the eye follows the digit and arrives at
 * the value knowing it just happened. The count is skipped entirely for values that
 * are not integers, because "10.6 MB" counted from zero is nonsense.
 */
export default function Stat({
  value,
  label,
  index = 0,
  share
}: {
  value: number | string
  label: string
  index?: number
  share?: number
}): React.JSX.Element {
  const target = typeof value === 'number' ? value : Number.NaN
  const counts = Number.isFinite(target) && Math.abs(target) < 100000
  const [shown, setShown] = useState(counts ? 0 : value)

  useEffect(() => {
    if (!counts) {
      setShown(value)
      return
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(target)
      return
    }

    let frame = 0
    const started = performance.now()
    const duration = 900

    function step(now: number): void {
      const t = Math.min(1, (now - started) / duration)
      // Expo-out: fast out of the gate, settling onto the number.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
      setShown(Math.round(target * eased))
      if (t < 1) frame = window.requestAnimationFrame(step)
    }

    frame = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(frame)
  }, [counts, target, value])

  return (
    <div className="stat" style={{ '--i': index } as React.CSSProperties}>
      <span className="stat-value">{shown}</span>
      <span className="stat-label">{label}</span>
      <span className="stat-bar" aria-hidden="true">
        <i style={{ '--v': Math.min(1, Math.max(0, share ?? (counts ? 1 : 0.6))) } as React.CSSProperties} />
      </span>
    </div>
  )
}
