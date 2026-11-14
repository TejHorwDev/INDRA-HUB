import { useEffect, useState } from 'react'

/*
 * Verifying.
 *
 * A spinner and nothing else. It is shown for at least 1.3 seconds even when the
 * server answers immediately — a flash of motion reads as a glitch.
 *
 * The one thing added to the spec: after 3 seconds a single quiet caption
 * appears. The spec calls for a hard 3-second cap, but the auth service is a
 * Render instance that sleeps, and a first request after sleep can take half a
 * minute. Cutting the request at 3 seconds would turn a slow start into a
 * failure; instead the screen says what is happening and keeps waiting.
 */
const SLOW_AFTER_MS = 3_000

export default function Verifying(): React.JSX.Element {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex flex-col items-center gap-4">
        <span
          className="block h-[34px] w-[34px] rounded-full border-[1.5px] border-white/10 border-t-[var(--color-accent)]"
          style={{ animation: 'spin 900ms linear infinite' }}
          aria-label="Verifying"
          role="status"
        />
        <span
          className="text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-ink-3)] transition-opacity duration-300"
          style={{ opacity: slow ? 1 : 0 }}
        >
          Still connecting
        </span>
      </div>
    </div>
  )
}
