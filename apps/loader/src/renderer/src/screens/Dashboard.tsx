import { useEffect, useMemo, useState } from 'react'
import type { InstallView, LoaderApp, LoaderConfig } from '@shared/types'
import { isAvailable } from '@shared/access'
import Card from '../components/Card'
import WindowControls from '../components/WindowControls'

/*
 * The library.
 *
 * Three cards at a time in a 724-wide strip at x88, arrows either side at the
 * vertical centre of the strip, dots underneath. Paging is state, not scroll: a
 * horizontal scrollbar inside a fixed window is a place a user can get lost.
 *
 * The empty state is a real state, not a placeholder card — "no apps" has to
 * look finished, because it is what a new account actually sees.
 */

/*
 * Three squares, and nothing else.
 *
 * The strip is a fixed grid rather than a flexible row: three cards of one size,
 * two gaps, inside a 732px viewport. Flexible widths were the reason two apps looked
 * like a mistake — the row stretched to fill and the cards ended up wider than the
 * artwork inside them.
 *
 * More than three means another page, not a smaller card. The catalogue grows; the
 * card does not.
 */
const PAGE_SIZE = 3
const CARD = 232
const GAP = 18
const RAIL_WIDTH = PAGE_SIZE * CARD + (PAGE_SIZE - 1) * GAP

/** The window, from `src/main/index.ts`. The rail is centred in it. */
const WINDOW_WIDTH = 900
/** Where the title and the rail both start, so the page has one left edge. */
const GUTTER = (WINDOW_WIDTH - RAIL_WIDTH) / 2

interface Props {
  apps: LoaderApp[]
  owned: string[]
  installs: Record<string, InstallView>
  config: LoaderConfig
  username: string | null
  loading: boolean
  onSettings: () => void
  onOpen: (app: LoaderApp) => void
  onLocked: (app: LoaderApp) => void
  onWebsite: () => void
}

export default function Dashboard({
  apps,
  owned,
  installs,
  config,
  username,
  loading,
  onSettings,
  onOpen,
  onLocked,
  onWebsite
}: Props): React.JSX.Element {
  const [page, setPage] = useState(0)
  /* Which way the next page slides in from, so the movement matches the arrow. */
  const [direction, setDirection] = useState<'next' | 'prev'>('next')
  const pages = Math.max(1, Math.ceil(apps.length / PAGE_SIZE))

  // A catalogue that shrinks must never leave the view on a page that is gone.
  useEffect(() => {
    setPage((current) => Math.min(current, pages - 1))
  }, [pages])

  const visible = useMemo(
    () => apps.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [apps, page]
  )

  return (
    <div className="absolute inset-0">
      {/*
        * What the panel wants to say. It sits above the strip, in the app's own
        * voice, and it is absent entirely when there is nothing to say — a banner
        * that reserves space for itself reads as a permanent fixture.
        */}
      {config.notice ? (
        <div
          className="absolute top-[46px] rounded-lg border border-[var(--color-edge)] bg-[rgba(255,255,255,0.05)] px-3 py-2 text-[11px] leading-[1.5] text-[var(--color-ink-2)]"
          role="status"
          style={{ left: GUTTER, right: GUTTER }}
        >
          {config.notice}
        </div>
      ) : null}

      <div className="absolute left-6 top-[14px] max-w-[520px]">
        <div className="text-[9.5px] font-semibold uppercase tracking-[0.28em] text-[var(--color-ink-3)]">
          Indra Loader
        </div>
        {username ? (
          <div className="mt-[3px] truncate text-[11px] text-[var(--color-ink-2)]">{username}</div>
        ) : null}
      </div>

      <button
        type="button"
        aria-label="Settings"
        onClick={onSettings}
        className="absolute right-[86px] top-3 grid h-7 w-7 place-items-center rounded-md text-[var(--color-ink-3)] transition-colors duration-150 hover:bg-white/5 hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <WindowControls />

      <h1
        className="absolute top-[92px] text-[15px] font-semibold text-[var(--color-ink)]"
        style={{ left: GUTTER }}
      >
        Library
      </h1>
      <p className="absolute top-[116px] text-[11px] text-[var(--color-ink-3)]" style={{ left: GUTTER }}>
        {loading
          ? 'Loading your apps…'
          : apps.length === 0
            ? 'No apps published yet.'
            : `${apps.length} ${apps.length === 1 ? 'app' : 'apps'} available`}
      </p>

      <div
        className="absolute overflow-hidden"
        style={{
          left: GUTTER,
          top: 158,
          width: RAIL_WIDTH,
          height: CARD
        }}
      >
        {loading ? (
          <div className="rail flex h-full" style={{ gap: GAP }}>
            <Skeleton />
          </div>
        ) : apps.length === 0 ? (
          <EmptyState hasWebsite={Boolean(config.website)} onWebsite={onWebsite} />
        ) : (
          /*
           * The page is keyed, so React remounts the row and the entry animation
           * plays every time — a translate of the whole track would need its width
           * to stay constant, and the last page is often short.
           */
          <div
            key={page}
            data-direction={direction}
            className="rail flex h-full items-stretch justify-center"
            style={{ gap: GAP }}
          >
            {visible.map((app) => {
              const available = isAvailable(app, owned)
              return (
                <div key={app.id} className="h-full shrink-0" style={{ width: CARD }}>
                  <Card
                    app={app}
                    available={available}
                    install={installs[app.id] ?? null}
                    onOpen={() => {
                      if (available) onOpen(app)
                      else onLocked(app)
                    }}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Arrow
        side="left"
        disabled={page === 0 || apps.length <= PAGE_SIZE}
        onClick={() => {
          setDirection('prev')
          setPage((current) => Math.max(0, current - 1))
        }}
      />
      <Arrow
        side="right"
        disabled={page >= pages - 1 || apps.length <= PAGE_SIZE}
        onClick={() => {
          setDirection('next')
          setPage((current) => Math.min(pages - 1, current + 1))
        }}
      />

      {apps.length > PAGE_SIZE ? (
        <div className="absolute left-0 right-0 flex items-center justify-center gap-1.5" style={{ top: 410 }}>
          {Array.from({ length: pages }).map((_, index) => (
            <button
              key={index}
              type="button"
              aria-label={`Page ${index + 1}`}
              aria-current={index === page}
              onClick={() => setPage(index)}
              className={
                'h-1.5 rounded-full transition-[width,background-color] duration-200 ' +
                (index === page
                  ? 'w-5 bg-[var(--color-accent)]'
                  : 'w-1.5 bg-white/15 hover:bg-white/25')
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Arrow({
  side,
  disabled,
  onClick
}: {
  side: 'left' | 'right'
  disabled: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={side === 'left' ? 'Previous apps' : 'Next apps'}
      disabled={disabled}
      onClick={onClick}
      className="absolute grid h-[38px] w-[38px] place-items-center rounded-full border border-[var(--hairline)] bg-[var(--color-surface)] text-[var(--color-ink-2)] transition-[color,border-color] duration-150 hover:border-[var(--hairline-strong)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-25"
      style={{ [side]: 30, top: 158 + (CARD - 38) / 2 }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path
          d={side === 'left' ? 'M7.5 2.5 4 6l3.5 3.5' : 'M4.5 2.5 8 6l-3.5 3.5'}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

function EmptyState({
  hasWebsite,
  onWebsite
}: {
  hasWebsite: boolean
  onWebsite: () => void
}): React.JSX.Element {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <div className="grid h-11 w-11 place-items-center rounded-full border border-[var(--hairline)] bg-[var(--color-surface)]">
        <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="3" stroke="rgba(242,240,246,0.4)" strokeWidth="1.2" />
          <path d="M8 6.2v3.6M6.2 8h3.6" stroke="rgba(242,240,246,0.4)" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </div>
      <div className="text-center">
        <div className="text-[13px] font-medium text-[var(--color-ink)]">Nothing here yet</div>
        <div className="mt-1 text-[11.5px] text-[var(--color-ink-2)]">
          Apps appear as soon as they are published.
        </div>
      </div>
      {hasWebsite ? (
        <button
          type="button"
          onClick={onWebsite}
          className="mt-1 h-8 rounded-md border border-[var(--hairline)] bg-[var(--color-raised)] px-3 text-[11px] text-[var(--color-ink-2)] transition-colors duration-150 hover:border-[var(--hairline-strong)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          Visit website
        </button>
      ) : null}
    </div>
  )
}

function Skeleton(): React.JSX.Element {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="h-full shrink-0 animate-pulse border border-[var(--hairline)] bg-[var(--color-surface)]"
          style={{ width: CARD, borderRadius: 14, animationDelay: `${index * 90}ms` }}
        />
      ))}
    </>
  )
}
