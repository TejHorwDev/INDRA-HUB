import type { LoaderApp } from '@shared/types'
import Monogram from './Monogram'

/*
 * One product, 296 tall.
 *
 * The lift on hover is two pixels and the border brightens — no scale, no glow.
 * A card that is not openable still looks deliberate: same surface, dimmer
 * content, and the reason in the footer rather than a disabled grey overlay.
 */

interface Props {
  app: LoaderApp
  available: boolean
  onOpen: () => void
}

export default function Card({ app, available, onOpen }: Props): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative flex h-full flex-col overflow-hidden border border-[var(--hairline)] bg-[var(--color-surface)] text-left transition-[transform,border-color,box-shadow] duration-200 ease-[cubic-bezier(.22,.61,.36,1)] hover:-translate-y-0.5 hover:border-[var(--hairline-strong)] hover:shadow-[0_18px_40px_-18px_rgba(0,0,0,0.9)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      style={{ borderRadius: 14, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' }}
    >
      <div className="relative h-[132px] w-full shrink-0 overflow-hidden border-b border-[var(--hairline)]">
        <Monogram name={app.name} image={app.image} />
        {available ? null : (
          <div className="absolute inset-0 grid place-items-center bg-[#08080a]/55 backdrop-blur-[1px]">
            <LockGlyph />
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-4 py-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13.5px] font-semibold text-[var(--color-ink)]">
            {app.name}
          </span>
          <span className="shrink-0 rounded border border-[var(--hairline)] px-1.5 py-[1px] text-[9.5px] font-medium tracking-[0.04em] text-[var(--color-ink-3)]">
            v{app.version}
          </span>
        </div>

        <p className="line-clamp-2 text-[11.5px] leading-[17px] text-[var(--color-ink-2)]">
          {app.description || 'No description yet.'}
        </p>

        <div className="mt-auto flex items-center gap-1.5">
          <span
            className={
              'h-1 w-1 rounded-full ' +
              (available ? 'bg-[var(--color-success)]' : 'bg-[var(--color-ink-3)]')
            }
          />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
            {available ? 'Ready' : 'Locked'}
          </span>
        </div>
      </div>
    </button>
  )
}

function LockGlyph(): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="3.4"
        y="7"
        width="9.2"
        height="6.4"
        rx="1.6"
        stroke="rgba(242,240,246,0.55)"
        strokeWidth="1.2"
      />
      <path
        d="M5.6 7V5.4a2.4 2.4 0 0 1 4.8 0V7"
        stroke="rgba(242,240,246,0.55)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}
