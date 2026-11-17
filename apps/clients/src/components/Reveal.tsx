'use client'

/*
 * Scroll reveal, and nothing else.
 *
 * A single IntersectionObserver that marks things as shown once, then forgets them. No
 * per-element listeners, no library, no scroll hijacking — the page scrolls at whatever speed
 * the machine and the wheel decide, which matters more than any effect.
 *
 * The initial hidden state is applied through a `js` class that only this file sets: with
 * scripting off, or if this bundle fails to load, everything is simply visible.
 */

import { useEffect } from 'react'

export default function Reveal() {
  useEffect(() => {
    const root = document.documentElement
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    root.classList.add('js')

    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (reduced || !('IntersectionObserver' in window)) {
      for (const element of targets) element.dataset.shown = ''
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          ;(entry.target as HTMLElement).dataset.shown = ''
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    )

    for (const element of targets) observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return null
}
