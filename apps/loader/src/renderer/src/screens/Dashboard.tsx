import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InstallView, LoaderApp, LoaderConfig } from '@shared/types'
import { isAvailable } from '@shared/access'
import Card from '../components/Card'
import WindowControls from '../components/WindowControls'

/*
 * The library.
 *
 * Three cards in a 732-wide window with every product on one track, arrows either
 * side, dots underneath.
 *
 * It used to page: three cards were mounted, and pressing an arrow unmounted them and
 * mounted the next three with a 300ms slide. That is a redirect with a wipe on it, not
 * movement — the old cards vanish at the moment the new ones start arriving, so your eye
 * reads a cut. Worse, it was keyed on the page number, so nothing on screen survived the
 * change to be followed.
 *
 * Now every card is mounted once, on one track, and changing page is a translation of
 * that track. The cards you were looking at slide out and the next ones slide in, and
 * they are the same DOM nodes the whole way, so the movement is continuous — which is
 * the difference between a carousel and a slideshow.
 *
 * It moves the ways people actually try to move it:
 *
 *   arrows · the dots · ← → Home End · the wheel or a trackpad two-finger swipe ·
 *   or the cards themselves, dragged, with the release carrying the distance it was
 *   thrown. A drag and a throw land on a card boundary, never between two, and a drag
 *   is never mistaken for a click.
 *
 * One card per move rather than three: with a full window a three-card jump hides the
 * cards it passes, and the point of the motion is to see them go.
 */

/** How many cards are in view. The window does not grow; the catalogue does. */
const VISIBLE = 3
const CARD = 232
const GAP = 18
/** One card and one gap — the distance one move travels. */
const STEP = CARD + GAP
const RAIL_WIDTH = VISIBLE * CARD + (VISIBLE - 1) * GAP

/** The window, from `src/main/index.ts`. The rail is centred in it. */
const WINDOW_WIDTH = 900
/** Where the title and the rail both start, so the page has one left edge. */
const GUTTER = (WINDOW_WIDTH - RAIL_WIDTH) / 2

/** Pixels of movement below which a pointer press is still a click. */
const CLICK_SLOP = 6
/** A throw carries this many milliseconds of the pointer's speed into the distance. */
const THROW_MS = 130
/** Wheel travel that counts as one move. Notched mice and trackpads both land here. */
const WHEEL_STEP = 42
/** How long a wheel gesture stays open for more deltas. */
const WHEEL_IDLE_MS = 180

interface Props {
  apps: LoaderApp[]
  owned: string[]
  installs: Record<string, InstallView>
  config: LoaderConfig
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
  loading,
  onSettings,
  onOpen,
  onLocked,
  onWebsite
}: Props): React.JSX.Element {
  const [index, setIndex] = useState(0)
  /** Pixels of pointer travel on top of the resting position, while a drag is live. */
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)

  const maxIndex = Math.max(0, apps.length - VISIBLE)

  // A catalogue that shrinks must never leave the view past the end of the track.
  useEffect(() => {
    setIndex((current) => Math.min(current, maxIndex))
  }, [maxIndex])

  /** Where the track rests for a given card, in pixels to move it left. */
  const offsetFor = useCallback((value: number) => -value * STEP, [])

  const move = useCallback(
    (next: number) => {
      setIndex((current) => {
        const target = Math.max(0, Math.min(maxIndex, next))
        // A no-op still has to put the track back where it belongs after a shrug of a drag.
        if (target === current) setDrag(0)
        return target
      })
    },
    [maxIndex]
  )

  /*
   * The pointer.
   *
   * Kept in a ref rather than in state: this updates on every move event, and the track
   * is translated by the `drag` state alone. Only the last event before release matters
   * for the throw, and reading it out of a ref cannot be a tick behind.
   */
  const gesture = useRef<{
    id: number
    startX: number
    lastX: number
    lastAt: number
    velocity: number
    /** The index the drag started from, so a drag cannot compound on itself. */
    from: number
  } | null>(null)
  /** Set at release, read by the click that may follow: a drag is not a click. */
  const dragged = useRef(false)

  /*
   * A press is only noted here — nothing about the track changes yet.
   *
   * This used to capture the pointer and enter the dragging state on contact. Both of
   * those take the press away from the card underneath: capture retargets everything to
   * the strip, and the dragging styles turn card hit-testing off, so the card that was
   * pressed never receives the click that ends the press. Cards stopped opening.
   *
   * So contact does nothing at all. The strip commits to being a drag on the first move
   * that passes CLICK_SLOP, and a press that never moves is just a click on a card.
   */
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    if (maxIndex === 0) return
    gesture.current = {
      id: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      lastAt: event.timeStamp,
      velocity: 0,
      from: index
    }
    dragged.current = false
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const live = gesture.current
    if (!live || live.id !== event.pointerId) return

    const dx = event.clientX - live.startX
    const elapsed = Math.max(1, event.timeStamp - live.lastAt)
    live.velocity = (event.clientX - live.lastX) / elapsed
    live.lastX = event.clientX
    live.lastAt = event.timeStamp

    if (!dragged.current) {
      // Still a press on a card until it is not.
      if (Math.abs(dx) <= CLICK_SLOP) return
      dragged.current = true
      setDragging(true)
      /*
       * Taken only now: a drag that leaves the strip still belongs to the strip, and it
       * must get its own release even if that release lands outside the window.
       */
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        /* a synthetic event has no capture to give */
      }
    }

    /*
     * Resistance at the ends.
     *
     * Pulling past the first or last card gives a little, then fights back. A track that
     * moves freely into empty space is a broken track; one that refuses to move at all
     * feels broken in the other direction.
     */
    const past = (live.from === 0 && dx > 0) || (live.from === maxIndex && dx < 0)
    setDrag(past ? dx * 0.32 : dx)
  }

  const release = (event: React.PointerEvent<HTMLDivElement>): void => {
    const live = gesture.current
    if (!live || live.id !== event.pointerId) return
    gesture.current = null

    /*
     * A press that never moved is a click, and the click has already gone to the card.
     * There is nothing to settle and nothing to swallow.
     */
    if (!dragged.current) {
      setDragging(false)
      setDrag(0)
      return
    }

    const dx = event.clientX - live.startX
    const throwPx = live.velocity * THROW_MS
    // Content moved right means a lower index; the throw adds to the distance travelled.
    const travelled = dx + throwPx
    const target = live.from - Math.round(travelled / STEP)

    setDragging(false)
    setDrag(0)
    move(target)
  }

  /*
   * The wheel, and a trackpad's two fingers.
   *
   * One move per gesture, not one per event: a trackpad reports dozens of deltas for a
   * flick, and stepping on each of them would skip half the library. The accumulator
   * closes on its own when the fingers stop.
   */
  const wheel = useRef({ total: 0, until: 0 })
  const onWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    if (maxIndex === 0) return
    const now = event.timeStamp
    if (now > wheel.current.until) wheel.current.total = 0
    wheel.current.until = now + WHEEL_IDLE_MS

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    wheel.current.total += delta
    if (Math.abs(wheel.current.total) < WHEEL_STEP) return

    const direction = wheel.current.total > 0 ? 1 : -1
    wheel.current.total = 0
    move(index + direction)
  }

  // The keyboard, because a window with arrows in it is expected to answer them.
  useEffect(() => {
    if (maxIndex === 0) return
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      // Never take a key from something the user is typing into.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (target?.isContentEditable) return
      if (event.key === 'ArrowLeft') move(index - 1)
      else if (event.key === 'ArrowRight') move(index + 1)
      else if (event.key === 'Home') move(0)
      else if (event.key === 'End') move(maxIndex)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, maxIndex, move])

  const dots = useMemo(() => Array.from({ length: maxIndex + 1 }), [maxIndex])
  const resting = offsetFor(index)

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

      <button
        type="button"
        aria-label="Settings"
        onClick={onSettings}
        className="no-drag absolute right-[84px] top-2.5 z-50 grid h-8 w-8 place-items-center rounded-md text-[var(--color-ink-3)] transition-colors duration-150 hover:bg-white/5 hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
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
        className="absolute left-0 right-0 top-[96px] text-center text-[27px] font-semibold leading-none text-white"
        style={{ letterSpacing: '0.005em', textShadow: '0 2px 24px rgba(0,0,0,0.55)' }}
      >
        Browse library
      </h1>
      <p className="absolute left-0 right-0 top-[136px] text-center text-[11px] text-[var(--color-ink-3)]">
        {loading
          ? 'Loading your apps…'
          : apps.length === 0
            ? 'No apps published yet.'
            : `${apps.length} ${apps.length === 1 ? 'app' : 'apps'} available`}
      </p>

      <div
        className="carousel absolute"
        style={{ left: GUTTER, top: 184, width: RAIL_WIDTH, height: CARD }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        onWheel={onWheel}
        onClickCapture={(event) => {
          /*
           * The tail of a drag is not a press on the card it ended over.
           *
           * `detail === 0` is a click with no pointer behind it — Enter or Space on a
           * focused card — and that is never the end of a drag, so it is never eaten.
           */
          if (event.detail === 0) return
          if (!dragged.current) return
          dragged.current = false
          event.preventDefault()
          event.stopPropagation()
        }}
        data-dragging={dragging ? 'true' : 'false'}
      >
        {loading ? (
          <div className="card-track" style={{ gap: GAP }} data-moving="false">
            <Skeleton />
          </div>
        ) : apps.length === 0 ? (
          <EmptyState hasWebsite={Boolean(config.website)} onWebsite={onWebsite} />
        ) : (
          <div
            className="card-track"
            data-moving={dragging ? 'false' : 'true'}
            style={{
              gap: GAP,
              transform: `translate3d(${resting + drag}px, 0, 0)`
            }}
          >
            {apps.map((app) => {
              const available = isAvailable(app, owned)
              return (
                <div key={app.id} className="slot" style={{ width: CARD }}>
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
        disabled={index === 0 || maxIndex === 0}
        onClick={() => move(index - 1)}
      />
      <Arrow
        side="right"
        disabled={index >= maxIndex || maxIndex === 0}
        onClick={() => move(index + 1)}
      />

      {maxIndex > 0 ? (
        <div
          className="absolute left-0 right-0 flex items-center justify-center gap-1.5"
          style={{ top: 436 }}
        >
          {dots.map((_, position) => (
            <button
              key={position}
              type="button"
              aria-label={`Show apps ${position + 1} to ${Math.min(apps.length, position + VISIBLE)}`}
              aria-current={position === index}
              onClick={() => move(position)}
              className={
                'h-1.5 rounded-full transition-[width,background-color] duration-200 ' +
                (position === index
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
      className="absolute z-10 grid h-[38px] w-[38px] place-items-center rounded-full border border-[var(--hairline)] bg-[var(--color-surface)] transition-[color,border-color,opacity] duration-150 hover:border-[var(--hairline-strong)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-25"
      style={{ [side]: 30, top: 184 + (CARD - 38) / 2, color: 'var(--color-ink-2)' }}
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
