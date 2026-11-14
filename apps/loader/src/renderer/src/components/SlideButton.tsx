import { useRef, useState } from 'react'

/*
 * The drag-to-confirm control.
 *
 * A press alone does nothing: the knob has to travel 65% of the track, which is
 * what makes "Get Started" and "Sign In" deliberate actions rather than a button
 * someone clicks twice. Released early, it springs back; confirmed, it settles at
 * the end and returns to rest when the work finishes.
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
  const knob = height - 8
  const max = Math.max(0, width - knob - 8)

  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const origin = useRef(0)

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

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (locked) return
    event.currentTarget.setPointerCapture(event.pointerId)
    origin.current = event.clientX - offset
    setDragging(true)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (!dragging) return
    const next = event.clientX - origin.current
    setOffset(Math.min(max, Math.max(0, next)))
  }

  function onPointerUp(): void {
    if (!dragging) return
    setDragging(false)
    if (offset >= max * 0.65) {
      void confirm()
    } else {
      settle()
    }
  }

  return (
    <div
      className="relative overflow-hidden border border-[var(--hairline)] bg-[var(--color-raised)]"
      style={{
        width,
        height,
        borderRadius: 10,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)'
      }}
    >
      {/* The fill that follows the knob, so the track reads as progress. */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 bg-[var(--color-accent)]/10"
        style={{ width: offset + knob + 8, transition: dragging ? 'none' : `width 220ms ${REST}` }}
      />

      <span
        className="pointer-events-none absolute inset-0 grid place-items-center text-[11.5px] font-medium tracking-[0.02em] text-[var(--color-ink-2)]"
        style={{ opacity: Math.max(0, 1 - progress * 1.7) }}
      >
        {label}
      </span>

      <div
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
        className={
          'absolute top-1 grid place-items-center rounded-[8px] bg-gradient-to-b from-[#ffffff] to-[#d6d6db] ' +
          'text-[#0b0a0f] shadow-[0_2px_8px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.35)] ' +
          'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ' +
          (locked ? 'cursor-default opacity-60' : dragging ? 'cursor-grabbing' : 'cursor-grab')
        }
        style={{
          width: knob,
          height: knob,
          left: 4,
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
