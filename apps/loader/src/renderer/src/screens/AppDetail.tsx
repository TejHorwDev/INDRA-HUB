import type { InstallView, LoaderApp } from '@shared/types'
import Monogram from '../components/Monogram'

/*
 * The detail overlay.
 *
 * No background of its own: it used to paint over the whole window, which meant the
 * film stopped at this screen and started again behind the library — the one place
 * where the background was visibly a decision rather than the room the app is in.
 * The library is simply not rendered behind it, so the detail has the window to
 * itself and the film runs through.
 *
 * The arrangement is a grid, not a set of coordinates. It was coordinates: artwork at
 * (28,84) 300×300, text from x368, buttons at y448 with widths of 312 and 180 — five
 * numbers that each had to be kept in agreement by hand, and were not. What that
 * looked like was a name floating above a void, a status line of unreadable caps, and
 * two buttons of different sizes stopping a few pixels past the text column.
 *
 * Now: one centred block, two columns. The artwork is 340 and square; the right
 * column is exactly as tall as the artwork, with the name at its top and the actions
 * at its foot, so the buttons line up with the bottom edge of the picture and the
 * empty space between them is the layout breathing rather than a gap left over.
 *
 * The version is gone — it is the same number for every product until you update it,
 * and it only changes when an update arrives. What is left is one line: available,
 * what state it is in, and who vouches for it.
 *
 * The action row is a state machine and the only place anything starts:
 *
 *   not installed → Download (white) · Launch (disabled)
 *   downloading   → progress and speed · Cancel
 *   installed     → Open folder · Launch (white)
 *   running       → Open folder · Running (dimmed)
 *
 * White is the primary now. The green Launch button was the last colour in an app
 * that is otherwise matte black and white, and it made the disabled state look
 * enabled.
 */

interface Props {
  app: LoaderApp
  install: InstallView | null
  running: boolean
  onBack: () => void
  onDownload: () => void
  onCancel: () => void
  onLaunch: () => void
  onReveal: () => void
}

const ART = 340
const COLUMN = 452
const GAP = 44
const BUTTON = 46

export default function AppDetail({
  app,
  install,
  running,
  onBack,
  onDownload,
  onCancel,
  onLaunch,
  onReveal
}: Props): React.JSX.Element {
  const state = install?.state ?? 'absent'
  const percent = install?.percent ?? 0

  /*
   * A server that does not say how big the file is cannot be turned into a percentage.
   * The panel does say now, but the loader must not depend on that to look alive: with no
   * total, the count of bytes received is the honest number, and "0%" for two minutes is
   * how this looked broken even when it was working.
   */
  const metered = Boolean(install && install.total > 0)
  const megabytes = install ? (install.received / 1048576).toFixed(1) : '0.0'
  const installed = state === 'installed'

  const size = install && install.total > 0 ? `${(install.total / 1048576).toFixed(1)} MB` : ''
  const status = running
    ? 'Running'
    : state === 'downloading'
      ? metered
        ? `Downloading ${percent}%`
        : `Downloading ${megabytes} MB`
      : installed
        ? size
          ? `Downloaded · ${size}`
          : 'Downloaded'
        : state === 'error'
          ? 'Download failed'
          : 'Not downloaded'

  return (
    <div className="absolute inset-0 z-30">
      <CircleButton label="Back" left={28} onClick={onBack}>
        <path d="M7.5 2.5 4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </CircleButton>

      <CircleButton label="Close" left={834} onClick={onBack}>
        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </CircleButton>

      {/*
        The composition. One row, vertically centred in the window, sized by the two
        columns and nothing else — so the whole thing is balanced whatever the window
        does, and every edge is another edge's business.
      */}
      <div className="absolute inset-0 flex items-center justify-center" style={{ gap: GAP }}>
        {/* The artwork: edge to edge, unboxed, a shadow where a border used to be. */}
        <div
          className="shrink-0 overflow-hidden"
          style={{
            width: ART,
            height: ART,
            borderRadius: 16,
            boxShadow: '0 40px 90px -40px rgba(0,0,0,0.95)'
          }}
        >
          <Monogram name={app.name} image={app.image} initialClassName="text-[96px]" />
        </div>

        {/* The column is the artwork's height at least: name at the top, actions at
            the foot, the space between belonging to both. `minHeight` rather than
            `height` so a long description pushes the row instead of being clipped —
            the artwork stays square and simply centres against it. */}
        <div className="flex flex-col" style={{ width: COLUMN, minHeight: ART }}>
          <div>
            <h2
              className="text-[27px] font-semibold leading-none text-white"
              style={{ letterSpacing: '-0.01em', textShadow: '0 2px 24px rgba(0,0,0,0.6)' }}
            >
              {app.name}
            </h2>

            <div className="mt-[13px] flex items-center gap-[10px] text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
              <span className="flex items-center gap-[6px]">
                <span
                  className={
                    'h-[5px] w-[5px] rounded-full ' +
                    (app.status === 'active' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-ink-3)]')
                  }
                />
                <span className={app.status === 'active' ? 'text-[var(--color-ink-2)]' : ''}>
                  {app.status === 'active' ? 'Available' : 'Unavailable'}
                </span>
              </span>
              <Rule />
              <span>{status}</span>
              <Rule />
              <span>{app.keyauthAppId ? 'INDRA Auth' : 'Included'}</span>
            </div>

            {/* Nothing is better than a placeholder sentence pretending to be copy. */}
            {app.description ? (
              <p className="mt-[18px] max-w-[430px] text-[12.5px] leading-[20px] text-[var(--color-ink-2)]">
                {app.description}
              </p>
            ) : null}

            {install?.error ? (
              <p className="mt-[14px] max-w-[430px] text-[11px] leading-[17px] text-[var(--color-danger)]">
                {install.error}
              </p>
            ) : null}
          </div>

          {/*
            Pushed to the foot of the column. There is no Download button once the file
            is in the library — a download that has already happened is not an action,
            it is a fact, and the button that matters is Launch. It comes back on its own
            if the file is deleted, because `installed()` reads the disk rather than a
            memory of what happened.
          */}
          <div className="mt-auto flex" style={{ gap: 12 }}>
            {state === 'downloading' ? (
              <>
                <div
                  className="relative grid flex-1 place-items-center overflow-hidden border border-[var(--hairline)] bg-[var(--color-raised)]/80 text-[12.5px] font-medium text-[var(--color-ink)] backdrop-blur-[2px]"
                  style={{ height: BUTTON, borderRadius: 10 }}
                >
                  {metered ? (
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 bg-[var(--color-accent)]/16 transition-[width] duration-200"
                      style={{ width: `${percent}%` }}
                    />
                  ) : (
                    /* No length from the server: an indeterminate stripe that moves,
                       because something is happening and the interface should say so. */
                    <span aria-hidden className="download-stripe absolute inset-y-0 left-0 w-1/3" />
                  )}
                  <span className="relative">
                    {metered ? `${percent}%` : `${megabytes} MB`}
                    {install && install.bytesPerSecond > 0
                      ? ` · ${Math.round(install.bytesPerSecond / 1_000_000)} MB/s`
                      : ''}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onCancel}
                  className="grid flex-1 place-items-center border border-[var(--hairline)] bg-transparent text-[12.5px] font-medium text-[var(--color-ink-2)] transition-colors duration-150 hover:border-[var(--hairline-strong)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                  style={{ height: BUTTON, borderRadius: 10 }}
                >
                  Cancel
                </button>
              </>
            ) : installed ? (
              <>
                <button
                  type="button"
                  onClick={onLaunch}
                  disabled={running}
                  className="grid flex-1 place-items-center bg-[#f2f2f4] text-[12.5px] font-semibold text-[#0a0a0c] transition-[background,color] duration-150 hover:bg-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:bg-white/[0.06] disabled:text-[var(--color-ink-3)] disabled:hover:bg-white/[0.06]"
                  style={{ height: BUTTON, borderRadius: 10 }}
                >
                  {running ? 'Running' : 'Launch'}
                </button>
                <button
                  type="button"
                  onClick={onReveal}
                  className="grid place-items-center border border-[var(--hairline-strong)] bg-transparent px-4 text-[12.5px] font-medium text-[var(--color-ink-2)] transition-[border-color,color] duration-150 hover:border-white/25 hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                  style={{ height: BUTTON, borderRadius: 10 }}
                >
                  Open folder
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onDownload}
                className="grid flex-1 place-items-center bg-[#f2f2f4] text-[12.5px] font-semibold text-[#0a0a0c] transition-[background] duration-150 hover:bg-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                style={{ height: BUTTON, borderRadius: 10 }}
              >
                {state === 'error' ? 'Try again' : 'Download'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** A hairline between two facts, so the line reads as three parts and not one. */
function Rule(): React.JSX.Element {
  return <span aria-hidden className="h-[9px] w-px bg-white/20" />
}

function CircleButton({
  label,
  left,
  onClick,
  children
}: {
  label: string
  left: number
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="no-drag absolute z-50 grid h-[38px] w-[38px] place-items-center rounded-full border border-[var(--hairline)] bg-[var(--color-surface)]/80 text-[var(--color-ink-2)] backdrop-blur-[2px] transition-[color,border-color,background] duration-150 hover:border-[var(--hairline-strong)] hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      style={{ left, top: 20 }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        {children}
      </svg>
    </button>
  )
}
