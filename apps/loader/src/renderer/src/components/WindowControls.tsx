import { bridge } from '../lib/bridge'

/*
 * The window has no frame, so these are the only way to close it.
 *
 * Deliberately quiet: they sit at 22% white until hovered, which keeps them out
 * of the composition while still being where a Windows user looks.
 */
export default function WindowControls(): React.JSX.Element {
  return (
    <div className="no-drag absolute right-3 top-3 z-50 flex items-center gap-1">
      <button
        type="button"
        aria-label="Minimise"
        onClick={() => bridge.window.minimize()}
        className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-ink-2)] opacity-70 transition-[opacity,background,color] duration-150 hover:bg-white/6 hover:text-[var(--color-ink)] hover:opacity-100"
      >
        <span className="block h-px w-3 bg-current" />
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={() => bridge.window.close()}
        className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-ink-2)] opacity-70 transition-[opacity,background,color] duration-150 hover:bg-[var(--color-danger)]/15 hover:text-[var(--color-danger)] hover:opacity-100"
      >
        <span className="relative block h-3 w-3">
          <span className="absolute left-1/2 top-1/2 block h-px w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-current" />
          <span className="absolute left-1/2 top-1/2 block h-px w-3 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-current" />
        </span>
      </button>
    </div>
  )
}
