import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'

interface ResizerProps {
  label: string
  /** Called with the horizontal movement since the previous pointer event. */
  onResize: (deltaX: number) => void
}

/** Vertical divider that resizes the panels beside it. */
export default function Resizer({ label, onResize }: ResizerProps) {
  const [dragging, setDragging] = useState(false)
  const lastX = useRef(0)

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    lastX.current = event.clientX
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const delta = event.clientX - lastX.current
    if (delta === 0) return
    lastX.current = event.clientX
    onResize(delta)
  }

  function stopDragging(event: PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onResize(-16)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onResize(16)
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      className={dragging ? 'resizer resizer--active' : 'resizer'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onKeyDown={handleKeyDown}
    />
  )
}
