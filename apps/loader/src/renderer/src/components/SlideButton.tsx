import { useRef, useState } from 'react'

/*
 * The drag-to-confirm control.
 *
 * A press alone does nothing: the knob has to travel most of the track, which is what
 * makes "Get Started" and "Authenticate" deliberate actions rather than a button
 * someone clicks twice. Released early, it springs back; confirmed, it settles at the
 * end and returns to rest when the work finishes.
 *
 * The knob used to be the only thing that accepted a press — a 32px circle you had to
 * hit exactly, inside a control you were already aiming at. That is a drag handle, not
 * a button, and it is why it felt unclickable: miss it by three pixels and the window
 * did nothing at all. The whole track takes the press now, the knob jumps to the
 * pointer, and the gesture is the same whether you drag it across or simply press near
 * the end — which is what most people will do.
 *
 * `touch-action: none` because without it a touch screen reads the drag as a scroll
 * and cancels it halfway.
 *
 * Pointer capture rather than window listeners, so a drag that leaves the control
 * still finishes cleanly, and Enter/Space work for anyone not using a mouse.
 */

interface Props {
  label: string
  width: number
  height?: number
  disabled?: boolean
  onConfirm: () => void | Promise<void>
}

const REST = 'cubic-bezier(.22,.61,.36,1)'

export default function SlideButton({
  label,
  width,
  height = 40,
  disabled = false,
  onConfirm
}: Props): React.JSX.Element {
  /* Even margins all round, so the knob is centred in the track rather than near it. */
  const inset = 3
  const knob = height - inset * 2
  const max = Math.max(0, width - knob - inset * 2)

  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const track = useRef<HTMLDivElement>(null)

  const progress = max === 0 ? 0 : offset / max
  const locked = disabled || confirming

  function settle(): void {
    setOffset(0)
  }

  async function confirm(): Promise<void> {
    if (locked) return
    setConfirming(true)
    setOffset(max)
    try {
      await onConfirm()
    } finally {
      setConfirming(false)
      settle()
    }
  }

  /** Puts the knob under the pointer, wherever on the track the press landed. */
  function follow(clientX: number): void {
    const box = track.current?.getBoundingClientRect()
    if (!box) return
    const next = clientX - box.left - knob / 2
    setOffset(Math.min(max, Math.max(0, next)))
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (locked || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    follow(event.clientX)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (!dragging) return
    follow(event.clientX)
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    if (!dragging) return
    setDragging(false)

    /*
     * The decision is made from where the pointer is, not from the state.
     *
     * A press and release in the same frame — which is what a click is — has not
     * re-rendered yet, so `offset` is still the value from before the press. Reading
     * it here meant a single click on the far end of the track did nothing at all,
     * which is the other half of why this control felt dead.
     */
    const box = track.current?.getBoundingClientRect()
    const travelled = box
      ? Math.min(max, Math.max(0, event.clientX - box.left - knob / 2))
      : offset

    if (travelled >= max * 0.55) {
      void confirm()
    } else {
      settle()
    }
  }

  return (
    <div
      ref={track}
      role="button"
      tabIndex={locked ? -1 : 0}
      aria-label={label}
      aria-disabled={locked}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          void confirm()
        }
      }}
      className="relative select-none overflow-hidden border border-[var(--hairline)] bg-[var(--color-raised)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      style={{
        width,
        height,
        borderRadius: 10,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
        touchAction: 'none',
        cursor: locked ? 'default' : 'pointer'
      }}
    >
      {/* The fill that follows the knob, so the track reads as progress. */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 bg-[var(--color-accent)]/10"
        style={{ width: offset + knob + inset * 2, transition: dragging ? 'none' : `width 220ms ${REST}` }}
      />

      <span
        className="pointer-events-none absolute inset-0 grid place-items-center text-[11.5px] font-medium tracking-[0.02em] text-[var(--color-ink-2)]"
        style={{ opacity: Math.max(0, 1 - progress * 1.7) }}
      >
        {label}
      </span>

      <div
        aria-hidden
        className={
          'absolute grid place-items-center rounded-[8px] bg-gradient-to-b from-[#ffffff] to-[#d6d6db] ' +
          'text-[#0b0a0f] shadow-[0_2px_8px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.35)] ' +
          'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ' +
          (locked ? 'cursor-default opacity-60' : dragging ? 'cursor-grabbing' : 'cursor-grab')
        }
        style={{
          width: knob,
          height: knob,
          left: inset,
          top: inset,
          transform: `translateX(${offset}px)`,
          transition: dragging ? 'none' : `transform 260ms ${REST}`
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M4.5 2.5 8 6l-3.5 3.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  )
}
