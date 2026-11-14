'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

const LINKS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/apps', label: 'Products' },
  { href: '/admin/storage', label: 'Storage' },
  { href: '/admin/settings', label: 'Settings' }
]

/*
 * The section switcher.
 *
 * The active state is a single pill that *moves* to whichever item you chose, rather
 * than a background that blinks from one to the other. That is the whole trick: the
 * eye follows the pill, so the page change reads as one continuous space instead of
 * four unrelated screens.
 *
 * Measurement is done after mount and on resize, and suppressed for anyone who asked
 * for reduced motion — the pill still lands in the right place, it just does not travel.
 */
export default function Nav(): React.JSX.Element {
  const path = usePathname()
  const holder = useRef<HTMLElement | null>(null)
  const [place, setPlace] = useState<{ x: number; w: number } | null>(null)

  useEffect(() => {
    const nav = holder.current
    if (!nav) return

    function measure(): void {
      if (!nav) return
      const active = nav.querySelector<HTMLAnchorElement>('a[data-active="true"]')
      if (!active) {
        setPlace(null)
        return
      }
      setPlace({ x: active.offsetLeft, w: active.offsetWidth })
    }

    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(nav)
    window.addEventListener('resize', measure)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [path])

  return (
    <nav className="nav" ref={holder} aria-label="Sections">
      <span
        className="nav-pill"
        aria-hidden="true"
        data-ready={place !== null}
        style={
          {
            '--x': `${place?.x ?? 0}px`,
            '--w': `${place?.w ?? 0}px`
          } as React.CSSProperties
        }
      />
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} data-active={path === link.href}>
          {link.label}
        </Link>
      ))}
    </nav>
  )
}
