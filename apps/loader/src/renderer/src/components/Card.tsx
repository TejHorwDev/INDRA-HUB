import type { InstallView, LoaderApp } from '@shared/types'
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
  install: InstallView | null
  onOpen: () => void
}

export default function Card({ app, available, install, onOpen }: Props): React.JSX.Element {
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
              (install?.state === 'installed'
                ? 'bg-[var(--color-success)]'
                : available
                  ? 'bg-[var(--color-accent)]'
                  : 'bg-[var(--color-ink-3)]')
            }
          />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
            {label(available, install)}
          </span>
        </div>
      </div>

      {/* A downloaded file has a state the footer can only describe in words. */}
      {install?.state === 'downloading' ? (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[2px] bg-[var(--color-accent)] transition-[width] duration-200"
          style={{ width: `${install.percent}%`, left: 0 }}
        />
      ) : null}
    </button>
  )
}

function label(available: boolean, install: InstallView | null): string {
  if (!available) return 'Locked'
  if (install?.state === 'downloading') return `Downloading ${install.percent}%`
  if (install?.state === 'installed') return 'Installed'
  if (install?.state === 'error') return 'Download failed'
  return 'Ready'
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
