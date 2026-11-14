import type { InstallView, LoaderApp } from '@shared/types'
import Monogram from '../components/Monogram'

/*
 * The detail overlay.
 *
 * Fills the window: preview on the left at x28, 340x332; everything written on
 * the right from x396, 476 wide; the action row across the bottom at y444.
 *
 * The action row is a state machine, not a fixed pair of buttons. Four states
 * exist and all four are reachable:
 *
 *   not installed → Download (546 wide) · Launch (disabled)
 *   downloading   → progress and speed in the left slot · Cancel in the right
 *   installed     → "Installed · open folder" · Launch in #34c395
 *   running       → the same, with Launch reading "Running" and disabled
 *
 * Failed downloads keep the same shape: the left button becomes "Try again" and
 * the sentence explaining why sits above it, in the detail column.
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

  return (
    <div className="absolute inset-0 z-30 bg-[var(--color-bg)]">
      <CircleButton label="Back" left={46} onClick={onBack}>
        <path d="M7.5 2.5 4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </CircleButton>

      <CircleButton label="Close" left={856} onClick={onBack}>
        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </CircleButton>

      <div
        className="absolute overflow-hidden border border-[var(--hairline)] bg-[var(--color-surface)]"
        style={{ left: 28, top: 100, width: 340, height: 332, borderRadius: 14 }}
      >
        <Monogram name={app.name} image={app.image} initialClassName="text-[72px]" />
      </div>

      <div className="absolute" style={{ left: 396, top: 100, width: 476 }}>
        <h2 className="text-[22px] font-semibold leading-none text-[var(--color-ink)]">{app.name}</h2>

        <div className="mt-3 flex items-center gap-2">
          <span className="rounded border border-[var(--hairline)] px-1.5 py-[2px] text-[10px] font-medium tracking-[0.04em] text-[var(--color-ink-2)]">
            v{app.version}
          </span>
          <span
            className={
              'flex items-center gap-1.5 rounded border border-[var(--hairline)] px-1.5 py-[2px] text-[10px] font-medium uppercase tracking-[0.08em] ' +
              (app.status === 'active' ? 'text-[var(--color-ink-2)]' : 'text-[var(--color-ink-3)]')
            }
          >
            <span
              className={
                'h-1 w-1 rounded-full ' +
                (app.status === 'active' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-ink-3)]')
              }
            />
            {app.status === 'active' ? 'Available' : 'Unavailable'}
          </span>
        </div>

        <p className="mt-4 text-[12px] leading-[19px] text-[var(--color-ink-2)]">
          {app.description || 'No description yet.'}
        </p>

        <div className="mt-6 border-t border-[var(--hairline)] pt-3">
          <Row label="Version" value={app.version} />
          <Row
            label="Status"
            value={
              running
                ? 'Running'
                : state === 'downloading'
                  ? `Downloading ${percent}%`
                  : installed
                    ? 'Installed'
                    : state === 'error'
                      ? 'Download failed'
                      : 'Not installed'
            }
          />
          {install?.error ? (
            <p className="mt-2 text-[10.5px] leading-[16px] text-[var(--color-danger)]">{install.error}</p>
          ) : null}
          <Row label="Licence" value={app.keyauthAppId ? 'INDRA Auth' : 'Included'} />
        </div>
      </div>

      {/* The action row: the only place a download or a launch can start. */}
      <div className="absolute flex gap-[14px]" style={{ left: 28, top: 444, height: 50 }}>
        <button
          type="button"
          onClick={
            state === 'downloading'
              ? undefined
              : installed
                ? onReveal
                : onDownload
          }
          disabled={state === 'downloading'}
          className="relative grid place-items-center overflow-hidden rounded-[10px] border border-[var(--hairline)] bg-[var(--color-raised)] text-[12.5px] font-medium text-[var(--color-ink)] transition-[border-color,background] duration-150 hover:border-[var(--hairline-strong)] hover:bg-[#17171b] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-default"
          style={{ width: 546, height: 50 }}
        >
          {state === 'downloading' ? (
            <>
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-[var(--color-accent)]/20 transition-[width] duration-200"
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
            className="grid place-items-center rounded-[10px] border border-[var(--hairline)] bg-[var(--color-raised)] text-[12.5px] font-medium text-[var(--color-ink-2)] transition-[color,border-color] duration-150 hover:border-[var(--hairline-strong)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            style={{ width: 284, height: 50 }}
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={onLaunch}
            disabled={!installed || running}
            className="grid place-items-center rounded-[10px] bg-[var(--color-success)] text-[12.5px] font-semibold text-[#06110d] transition-[filter] duration-150 hover:brightness-[1.06] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-success)] disabled:bg-[var(--color-raised)] disabled:text-[var(--color-ink-3)] disabled:hover:brightness-100"
            style={{ width: 284, height: 50 }}
          >
            {running ? 'Running' : 'Launch'}
          </button>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between border-b border-[var(--hairline)] py-[7px] last:border-b-0">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
        {label}
      </span>
      <span className="text-[11.5px] text-[var(--color-ink-2)]">{value}</span>
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
      className="no-drag absolute z-50 grid h-[38px] w-[38px] place-items-center rounded-full border border-[var(--hairline)] bg-[var(--color-surface)] text-[var(--color-ink-2)] transition-[color,border-color] duration-150 hover:border-[var(--hairline-strong)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      style={{ left, top: 44 }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        {children}
      </svg>
    </button>
  )
}
