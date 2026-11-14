'use client'

import { useEffect, useRef } from 'react'

/*
 * The room the panel sits in.
 *
 * Three things, one component, no re-render:
 *
 *   1. A pool of light that follows the pointer. On a matte surface it is the cheapest
 *      way to make the page feel physical — and it costs one compositor layer, driven
 *      from a CSS custom property rather than from React state.
 *   2. A grain overlay that steps a few percent every ninth of a second.
 *   3. A hairline at the very top that fills as you scroll, so a long table never
 *      leaves you wondering where you are.
 *
 * If the machine has asked for less motion, the light is left still and the grain is
 * dropped entirely by the stylesheet — this only stops writing the variables.
 */
export default function Ambience(): React.JSX.Element {
  const light = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const node = light.current
    let frame = 0

    function onMove(event: PointerEvent): void {
      if (!node || still) return
      if (frame) return

      frame = window.requestAnimationFrame(() => {
        frame = 0
        if (!node) return
        node.style.setProperty('--mx', `${Math.round(event.clientX)}px`)
        node.style.setProperty('--my', `${Math.round(event.clientY)}px`)
      })
    }

    function onScroll(): void {
      const span = document.documentElement.scrollHeight - window.innerHeight
      const progress = span > 0 ? Math.min(1, Math.max(0, window.scrollY / span)) : 0
      document.documentElement.style.setProperty('--p', progress.toFixed(4))
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    onScroll()

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    <>
      <div className="ambience" ref={light} aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <div className="scroll-progress" aria-hidden="true" />
    </>
  )
}
