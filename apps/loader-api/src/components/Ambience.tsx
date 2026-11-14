'use client'

import { useEffect, useRef } from 'react'

/*
 * The room the panel sits in, and the four things that make it feel alive.
 *
 *   1. A pool of light that follows the pointer. On a matte surface it is the cheapest
 *      way to make the page feel physical.
 *   2. Each card is lit from the same place: the pointer's position inside it sets two
 *      custom properties, and one radial-gradient does the rest.
 *   3. The card tilts — three degrees at most, toward the pointer. The panel is an
 *      object, not a toy.
 *   4. A ring follows the pointer a beat behind, and opens over anything pressable.
 *
 * All of it is one listener on one element, writing CSS variables — no React state, no
 * layout thrash, no re-render. A machine that asked for less motion gets the scroll
 * line and nothing else.
 */
export default function Ambience(): React.JSX.Element {
  const light = useRef<HTMLDivElement | null>(null)
  const ring = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const node = light.current
    const dot = ring.current

    let frame = 0
    let lit: HTMLElement | null = null
    let live = false

    function clear(target: HTMLElement | null): void {
      if (!target) return
      target.style.removeProperty('--px')
      target.style.removeProperty('--py')
      target.style.removeProperty('--rx')
      target.style.removeProperty('--ry')
    }

    function paint(event: PointerEvent): void {
      frame = 0

      if (node) {
        node.style.setProperty('--mx', `${Math.round(event.clientX)}px`)
        node.style.setProperty('--my', `${Math.round(event.clientY)}px`)
      }

      if (dot) {
        dot.style.setProperty('--cx', `${Math.round(event.clientX)}px`)
        dot.style.setProperty('--cy', `${Math.round(event.clientY)}px`)
        if (!live) {
          live = true
          dot.dataset.live = 'true'
        }
      }

      // What is under the pointer, nearest first.
      const under = event.target instanceof Element ? event.target : null
      const pressable = under?.closest('a, button, input, textarea, select, label, .tile, .nav a')

      if (dot) dot.dataset.over = pressable ? 'true' : 'false'

      const surface: HTMLElement | null = under?.closest<HTMLElement>('.card, .stat') ?? null

      if (surface !== lit) {
        clear(lit)
        lit = surface
      }

      if (surface && !still) {
        const box = surface.getBoundingClientRect()
        const x = (event.clientX - box.left) / Math.max(1, box.width)
        const y = (event.clientY - box.top) / Math.max(1, box.height)
        surface.style.setProperty('--px', `${(x * 100).toFixed(2)}%`)
        surface.style.setProperty('--py', `${(y * 100).toFixed(2)}%`)
        surface.style.setProperty('--ry', `${((x - 0.5) * 3).toFixed(2)}deg`)
        surface.style.setProperty('--rx', `${((0.5 - y) * 3).toFixed(2)}deg`)
      } else {
        clear(surface)
      }
    }

    function onMove(event: PointerEvent): void {
      if (still || frame) return
      frame = window.requestAnimationFrame(() => paint(event))
    }

    function onLeave(): void {
      clear(lit)
      lit = null
      if (dot) dot.dataset.live = 'false'
    }

    function onScroll(): void {
      const span = document.documentElement.scrollHeight - window.innerHeight
      const progress = span > 0 ? Math.min(1, Math.max(0, window.scrollY / span)) : 0
      document.documentElement.style.setProperty('--p', progress.toFixed(4))
    }

    if (fine) window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    onScroll()

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    <>
      <div className="ambience" ref={light} aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <div className="scroll-progress" aria-hidden="true" />
      <div className="ring" ref={ring} aria-hidden="true" />
    </>
  )
}
