import { useEffect, useRef, useState } from 'react'
import AuthLayout from './AuthLayout'

/**
 * The four seconds between proving who you are and being at your desk.
 *
 * It is not a fake delay dressed as work: the workspace is opening, the sign-in
 * video is still playing, and the next screen is a full shell rather than one
 * form. Showing the transition is calmer than a form that suddenly becomes a
 * dashboard.
 *
 * The ring is a single SVG stroke driven by the actual elapsed time, so it can
 * never reach 100% and then wait, or spin forever because a timer was missed.
 * The percentage in the middle is the same number, and the status lines change
 * beneath it so the four seconds have a shape.
 */

const DURATION_MS = 4000

const STAGES = [
  { at: 0, label: 'Opening your session' },
  { at: 0.3, label: 'Reading your workspace' },
  { at: 0.62, label: 'Bringing your projects in' },
  { at: 0.88, label: 'Almost there' }
]

const RADIUS = 54
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export default function OpeningScreen({
  name,
  detail,
  onDone
}: {
  name?: string
  detail?: string
  onDone: () => void
}) {
  const [progress, setProgress] = useState(0)
  // The callback changes identity on every render of the parent; the timer
  // must be started once, not restarted each time.
  const finished = useRef(onDone)
  finished.current = onDone

  useEffect(() => {
    const start = performance.now()
    let frame = requestAnimationFrame(function tick(now: number) {
      const next = Math.min(1, (now - start) / DURATION_MS)
      setProgress(next)
      if (next < 1) frame = requestAnimationFrame(tick)
      else finished.current()
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const percent = Math.round(progress * 100)
  const stage = [...STAGES].reverse().find((entry) => progress >= entry.at) ?? STAGES[0]

  return (
    <AuthLayout stage>
      <div className="opening" role="status" aria-live="polite">
        <div className="opening-mark">
          <svg className="opening-ring" viewBox="0 0 120 120" aria-hidden="true">
            <circle className="opening-ring-track" cx="60" cy="60" r={RADIUS} />
            <circle
              className="opening-ring-fill"
              cx="60"
              cy="60"
              r={RADIUS}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
            />
            <circle className="opening-ring-spin" cx="60" cy="60" r={RADIUS} />
          </svg>
          <span className="opening-percent" aria-hidden="true">
            {percent}
          </span>
        </div>

        <p className="opening-greeting">{name ? `Welcome, ${name}` : 'Opening INDRA HUB'}</p>
        <p className="opening-status" key={stage.label}>
          {stage.label}
        </p>

        <div
          className="opening-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Opening your workspace"
        >
          <span style={{ width: `${percent}%` }} />
        </div>

        <p className="opening-note">{detail ?? 'Your work stays on this PC'}</p>
      </div>
    </AuthLayout>
  )
}
