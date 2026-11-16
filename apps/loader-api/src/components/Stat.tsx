'use client'

import { useEffect, useState } from 'react'

/*
 * One number, at the size a number should be.
 *
 * It counts up — a figure that climbs from zero for half a second is a reading rather
 * than a screenshot. Everything else that used to live in this tile is gone: the wash
 * behind it, the lit border, the tilt, and the thin bar underneath that encoded a share
 * of a total nobody asked for. "3 active of 4" is a sentence, and the sentence is on the
 * page already.
 */
export default function Stat({
  value,
  label,
  index = 0
}: {
  value: number | string
  label: string
  index?: number
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
    </div>
  )
}
