import { useEffect, useRef } from 'react'
import AuthLayout from './AuthLayout'

/**
 * Four seconds of nothing but a ring turning, over the sign-in video.
 *
 * No percentage, no greeting, no status line — the same idea as a Windows
 * setup spinner: the machine is busy, that is the whole message. A number that
 * is not measuring anything real is worse than no number at all, and a
 * progress bar that fills on a timer is just a countdown wearing a costume.
 *
 * The wait is deliberate: the session has just become valid and the shell on
 * the other side is a whole workspace. Four seconds is long enough that the
 * transition reads as opening something, short enough that nobody waits.
 */

const DURATION_MS = 4000

export default function OpeningScreen({ onDone }: { onDone: () => void }) {
  // The parent re-renders while this is on screen; the timer must survive it.
  const finished = useRef(onDone)
  finished.current = onDone

  useEffect(() => {
    const timer = window.setTimeout(() => finished.current(), DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <AuthLayout stage>
      <div className="opening" role="status" aria-label="Opening INDRA HUB">
        <span className="opening-spinner" aria-hidden="true">
          <svg viewBox="0 0 120 120" focusable="false">
            <circle className="opening-spinner-track" cx="60" cy="60" r="48" />
            <circle className="opening-spinner-arc" cx="60" cy="60" r="48" />
          </svg>
        </span>
      </div>
    </AuthLayout>
  )
}
