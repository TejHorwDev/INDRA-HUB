import { useEffect, useState } from 'react'

/*
 * Verifying.
 *
 * A spinner and nothing else. It is shown for at least 1.3 seconds even when the
 * server answers immediately — a flash of motion reads as a glitch.
 *
 * After three seconds a single quiet caption appears: the auth service is a Render
 * instance that sleeps, and a first request after sleep can take half a minute.
 * Cutting the request at three seconds would turn a slow start into a failure, so the
 * screen says what is happening and keeps waiting.
 *
 * What it does not do is wait forever. This screen was, for one release, a way to lose
 * the app: a bug elsewhere left it up with no way back, and because it paints nothing
 * behind itself the window looked like a screenshot of somebody else's half-drawn
 * screen. So it now covers its own background, and after twelve seconds it offers the
 * only useful thing left — a way back to the sign-in form.
 */

const SLOW_AFTER_MS = 3_000
const ESCAPE_AFTER_MS = 12_000

export default function Verifying({ onBack }: { onBack?: () => void }): React.JSX.Element {
  const [slow, setSlow] = useState(false)
  const [escapable, setEscapable] = useState(false)

  useEffect(() => {
    const caption = setTimeout(() => setSlow(true), SLOW_AFTER_MS)
    const escape = setTimeout(() => setEscapable(true), ESCAPE_AFTER_MS)
    return () => {
      clearTimeout(caption)
      clearTimeout(escape)
    }
  }, [])

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-[var(--color-bg)]/70">
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

        {escapable && onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="fade-up text-[11px] text-[var(--color-ink-2)] underline decoration-white/20 underline-offset-[5px] transition-colors duration-150 hover:text-[var(--color-ink)] hover:decoration-white/40 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
          >
            Back to sign in
          </button>
        ) : null}
      </div>
    </div>
  )
}
