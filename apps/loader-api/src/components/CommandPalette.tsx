'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

/*
 * ⌘K.
 *
 * Four sections, a handful of endpoints, and one box that reaches all of them without
 * the pointer. It is not a command system — there is nothing to script here — it is a
 * door that opens with the keyboard, which is the fastest way around a tool you already
 * know.
 *
 * Everything is local: the list is a constant, the filter is a substring, and the
 * navigation is `router.push`. Nothing is fetched, so it opens in the same frame as the
 * keystroke.
 */

type Item = {
  label: string
  href: string
  hint: string
  external?: boolean
}

const ITEMS: Item[] = [
  { label: 'Overview', href: '/admin', hint: 'section' },
  { label: 'Products', href: '/admin/apps', hint: 'section' },
  { label: 'Storage', href: '/admin/storage', hint: 'section' },
  { label: 'Settings', href: '/admin/settings', hint: 'section' },
  { label: 'Sign-in film', href: '/admin/settings', hint: 'appearance' },
  { label: 'Announcement & maintenance', href: '/admin/settings', hint: 'broadcast' },
  { label: 'Website link', href: '/admin/settings', hint: 'links' },
  { label: 'Catalogue feed', href: '/api/loader/apps', hint: 'endpoint', external: true },
  { label: 'Loader config', href: '/api/loader/config', hint: 'endpoint', external: true },
  { label: 'Health', href: '/api/health', hint: 'endpoint', external: true }
]

export default function CommandPalette(): React.JSX.Element {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement | null>(null)

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return ITEMS
    return ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) || item.hint.toLowerCase().includes(needle)
    )
  }, [query])

  /* The shortcut. `k` with a modifier, and Escape to leave from anywhere. */
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((was) => !was)
        return
      }
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* Opening resets the box and puts the caret in it — a palette you have to click is
     a menu with extra steps. */
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    const frame = window.requestAnimationFrame(() => input.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, shown.length - 1)))
  }, [shown.length])

  function go(item: Item): void {
    setOpen(false)
    if (item.external) {
      window.open(item.href, '_blank', 'noreferrer')
      return
    }
    router.push(item.href)
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (shown.length ? (index + 1) % shown.length : 0))
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (shown.length ? (index - 1 + shown.length) % shown.length : 0))
    }
    if (event.key === 'Enter' && shown[active]) {
      event.preventDefault()
      go(shown[active])
    }
  }

  return (
    <>
      <button className="kbd-hint" type="button" onClick={() => setOpen(true)} aria-label="Open the jump box">
        <kbd>⌘K</kbd>
      </button>

      {open ? (
        <div
          className="palette-scrim"
          role="dialog"
          aria-modal="true"
          aria-label="Jump to"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <div className="palette" onKeyDown={onKeyDown}>
            <input
              ref={input}
              type="text"
              value={query}
              placeholder="Where do you want to go?"
              aria-label="Search sections and endpoints"
              onChange={(event) => {
                setQuery(event.target.value)
                setActive(0)
              }}
            />

            <div className="palette-list">
              {shown.length === 0 ? (
                <p className="palette-empty">Nothing matches that.</p>
              ) : (
                shown.map((item, index) => (
                  <button
                    key={`${item.label}-${item.href}`}
                    type="button"
                    className="palette-item"
                    data-active={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(item)}
                  >
                    {item.label}
                    <small>{item.hint}</small>
                  </button>
                ))
              )}
            </div>

            <div className="palette-foot">
              <span>↑↓ move</span>
              <span>↵ open</span>
              <span>esc close</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
