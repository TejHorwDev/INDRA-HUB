import type { InstallView, LoaderApp } from '@shared/types'
import Monogram from '../components/Monogram'

/*
 * The detail overlay.
 *
 * No background of its own. It used to paint `--color-bg` over the whole window,
 * which meant the film stopped at this screen and started again behind the library —
 * the one place in the app where the background was visibly a decision rather than the
 * room the app is in.
 *
 * What is here instead: the artwork on the left, and three things on the right — the
 * name, what it is, and what state it is in. The version is gone, from the pill and
 * from the table, because it is the same for every product in the catalogue until you
 * update it, and the only moment it matters is the moment it changes. The table it
 * used to sit in is gone with it: three labelled rows in a box is a settings panel, not
 * a product.
 *
 * The action row is still a state machine, and still the only place anything starts:
 *
 *   not installed → Download · Launch (disabled)
 *   downloading   → progress and speed · Cancel
 *   installed     → "Installed · open folder" · Launch
 *   running       → the same, with Launch reading "Running"
 *
 * White is the accent now, so Download is white and Launch is a hairline. The green
 * button was the last colour in the app.
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

/** The composition, in the window's own coordinates. */
const ART = { left: 28, top: 84, size: 300 }
const COLUMN = { left: 368, width: 504 }
const ACTIONS = 448

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
  const installed = state === 'installed'

  const status = running
    ? 'Running'
    : state === 'downloading'
      ? `Downloading ${percent}%`
      : installed
        ? 'Installed'
        : state === 'error'
          ? 'Download failed'
          : 'Not installed'

  return (
    <div className="absolute inset-0 z-30">
      <CircleButton label="Back" left={46} onClick={onBack}>
        <path d="M7.5 2.5 4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </CircleButton>

      <CircleButton label="Close" left={856} onClick={onBack}>
        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </CircleButton>

      {/* The artwork, edge to edge, with nothing drawn around it. */}
      <div
        className="absolute overflow-hidden"
        style={{
          left: ART.left,
          top: ART.top,
          width: ART.size,
          height: ART.size,
          borderRadius: 16,
          boxShadow: '0 30px 70px -30px rgba(0,0,0,0.95)'
        }}
      >
        <Monogram name={app.name} image={app.image} initialClassName="text-[84px]" />
      </div>

      <div className="absolute" style={{ left: COLUMN.left, top: ART.top, width: COLUMN.width }}>
        <h2
          className="text-[26px] font-semibold leading-none text-white"
          style={{ letterSpacing: '0.005em', textShadow: '0 2px 20px rgba(0,0,0,0.55)' }}
        >
          {app.name}
        </h2>

        {/* One line: is it available, is it installed, who vouches for it. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
          <span className="flex items-center gap-1.5">
            <span
              className={
                'h-1 w-1 rounded-full ' +
                (app.status === 'active' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-ink-3)]')
              }
            />
            {app.status === 'active' ? 'Available' : 'Unavailable'}
          </span>
          <span aria-hidden className="text-[var(--color-ink-3)]/50">·</span>
          <span>{status}</span>
          <span aria-hidden className="text-[var(--color-ink-3)]/50">·</span>
          <span>{app.keyauthAppId ? 'INDRA Auth' : 'Included'}</span>
        </div>

        <p className="mt-5 max-w-[460px] text-[12.5px] leading-[20px] text-[var(--color-ink-2)]">
          {app.description || 'No description yet.'}
        </p>

        {install?.error ? (
          <p className="mt-3 text-[11px] leading-[17px] text-[var(--color-danger)]">{install.error}</p>
        ) : null}
      </div>

      {/* The action row: the only place a download or a launch can start. */}
      <div className="absolute flex gap-3" style={{ left: COLUMN.left, top: ACTIONS, height: 48 }}>
        <button
          type="button"
          onClick={state === 'downloading' ? undefined : installed ? onReveal : onDownload}
          disabled={state === 'downloading'}
          className="relative grid place-items-center overflow-hidden border border-[var(--hairline-strong)] bg-[var(--color-raised)]/85 text-[12.5px] font-medium text-[var(--color-ink)] backdrop-blur-[2px] transition-[border-color,background] duration-150 hover:border-white/25 hover:bg-[var(--color-raised)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-default"
          style={{ width: 312, height: 48, borderRadius: 10 }}
        >
          {state === 'downloading' ? (
            <>
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-[var(--color-accent)]/18 transition-[width] duration-200"
                style={{ width: `${percent}%` }}
              />
              <span className="relative">
                Downloading… {percent}%
                {install && install.bytesPerSecond > 0
                  ? ` · ${Math.round(install.bytesPerSecond / 1_000_000)} MB/s`
                  : ''}
              </span>
            </>
          ) : (
            <span>
              {installed ? 'Installed · open folder' : state === 'error' ? 'Try again' : 'Download'}
            </span>
          )}
        </button>

        {state === 'downloading' ? (
          <button
            type="button"
            onClick={onCancel}
            className="grid place-items-center border border-[var(--hairline)] bg-transparent text-[12.5px] font-medium text-[var(--color-ink-2)] transition-colors duration-150 hover:border-[var(--hairline-strong)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            style={{ width: 180, height: 48, borderRadius: 10 }}
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={onLaunch}
            disabled={!installed || running}
            className="grid place-items-center bg-[#f2f2f4] text-[12.5px] font-semibold text-[#0a0a0c] transition-[background] duration-150 hover:bg-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:bg-white/6 disabled:text-[var(--color-ink-3)]"
            style={{ width: 180, height: 48, borderRadius: 10 }}
          >
            {running ? 'Running' : 'Launch'}
          </button>
        )}
      </div>
    </div>
  )
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
      style={{ left, top: 44 }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        {children}
      </svg>
    </button>
  )
}
