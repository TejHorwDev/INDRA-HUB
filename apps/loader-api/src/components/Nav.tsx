'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/apps', label: 'Products' },
  { href: '/admin/storage', label: 'Storage' },
  { href: '/admin/settings', label: 'Settings' }
]

/*
 * The section switcher.
 *
 * Four words, one of them white. That is the whole component now.
 *
 * It used to be a pill that measured itself after mount and slid to whichever item you
 * chose — a trick that costs a ResizeObserver, a ref, a state, and a reflow on resize, to
 * animate a background between four links in a header nobody looks at twice. At this
 * size an underline is not a lesser version of the same idea; it is the idea, and it
 * needs no JavaScript.
 */
export default function Nav(): React.JSX.Element {
  const path = usePathname()

  return (
    <nav className="nav" aria-label="Sections">
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} data-active={path === link.href}>
          {link.label}
        </Link>
      ))}
    </nav>
  )
}
