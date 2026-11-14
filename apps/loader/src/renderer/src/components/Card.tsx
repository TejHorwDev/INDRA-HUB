import type { InstallView, LoaderApp } from '@shared/types'
import Monogram from './Monogram'

/*
 * One product, one square of artwork.
 *
 * The card used to be a photograph with a footer under it: image on top, name,
 * version and a line of description below, all inside a bordered box. That is a
 * listing — the picture was an illustration of a row in a table, and at 232px the row
 * took half the card.
 *
 * Now the picture is the card. The name sits on it, over a scrim that darkens the
 * bottom third, and nothing else does: the version is in the product's own screen
 * where it can be read properly, and the description is the first thing you see when
 * you open it. A library of artwork with names on it is a shelf; a library of
 * bordered boxes with two lines of text each is a spreadsheet.
 *
 * What is left under the name is one small line of state — ready, locked, installed —
 * because whether a product will open is the only thing that belongs on the shelf.
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
      className="group relative h-full w-full overflow-hidden border border-[var(--hairline)] text-left transition-[transform,border-color,box-shadow] duration-200 ease-[cubic-bezier(.22,.61,.36,1)] hover:-translate-y-0.5 hover:border-[var(--hairline-strong)] hover:shadow-[0_22px_50px_-20px_rgba(0,0,0,0.95)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      style={{ borderRadius: 14, background: '#0c0c0f' }}
    >
      {/* The artwork fills the whole card, and moves a little on hover. */}
      <div className="absolute inset-0 transition-transform duration-500 ease-[cubic-bezier(.22,.61,.36,1)] group-hover:scale-[1.035]">
        <Monogram name={app.name} image={app.image} initialClassName="text-[54px]" />
      </div>

      {/*
        * The scrim.
        *
        * Not a panel — no edge, no blur, no box. Just the bottom of the picture going
        * dark enough for white type to sit on it, whatever the artwork happens to be
        * there. Without it, the name is legible on some cards and invisible on others.
        */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(6,6,8,0) 34%, rgba(6,6,8,0.30) 56%, rgba(6,6,8,0.86) 100%)'
        }}
      />

      {available ? null : (
        <div className="absolute inset-0 grid place-items-center bg-[#06060a]/45">
          <LockGlyph />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 px-4 pb-3.5">
        <span className="truncate text-[14px] font-semibold leading-tight text-white drop-shadow-[0_1px_8px_rgba(0,0,0,0.7)]">
          {app.name}
        </span>

        <span className="flex items-center gap-1.5">
          <span
            className={
              'h-1 w-1 rounded-full ' +
              (install?.state === 'installed'
                ? 'bg-[var(--color-success)]'
                : available
                  ? 'bg-white'
                  : 'bg-[var(--color-ink-3)]')
            }
          />
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-2)]">
            {label(available, install)}
          </span>
        </span>
      </div>

      {/* A download in progress has a state words cannot carry. */}
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
  if (install?.state === 'downloading') return `${install.percent}%`
  if (install?.state === 'installed') return 'Downloaded'
  if (install?.state === 'error') return 'Download failed'
  return 'Ready'
}

/** Drawn, not an emoji, and the same weight as every other line in the app. */
function LockGlyph(): React.JSX.Element {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.4" stroke="white" strokeWidth="1.4" />
      <path d="M8.4 10.5V8a3.6 3.6 0 0 1 7.2 0v2.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="12" cy="15.2" r="1.15" fill="white" />
    </svg>
  )
}
