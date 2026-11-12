import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { CornerDownLeftIcon, SearchIcon } from './icons'

export interface Command {
  id: string
  label: string
  hint?: string
  keywords?: string
  icon: ReactNode
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  commands: Command[]
  onClose: () => void
}

/**
 * A real command surface: everything it lists actually happens. Opened with
 * Ctrl+K from anywhere, driven entirely from the keyboard.
 */
export default function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((command) =>
      `${command.label} ${command.hint ?? ''} ${command.keywords ?? ''}`
        .toLowerCase()
        .includes(needle)
    )
  }, [commands, query])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      setQuery('')
      setActive(0)
      dialog.showModal()
      window.setTimeout(() => inputRef.current?.focus(), 30)
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  // Keep the highlighted row inside the scroll viewport.
  useEffect(() => {
    const item = listRef.current?.children[active] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => (results.length === 0 ? 0 : (current + 1) % results.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) =>
        results.length === 0 ? 0 : (current - 1 + results.length) % results.length
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const command = results[active]
      if (command) {
        onClose()
        command.run()
      }
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="palette"
      aria-label="Command palette"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
    >
      <div className="palette-search">
        <SearchIcon size={15} className="palette-search-icon" />
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search or jump to…"
          aria-label="Search commands"
          spellCheck={false}
          autoComplete="off"
        />
        <span className="kbd" style={{ position: 'static' }}>
          Esc
        </span>
      </div>

      <ul className="palette-list" ref={listRef} role="listbox" aria-label="Commands">
        {results.length === 0 && <li className="palette-empty">No matching commands</li>}
        {results.map((command, index) => (
          <li key={command.id} role="option" aria-selected={index === active}>
            <button
              type="button"
              className={`palette-item${index === active ? ' palette-item--active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                onClose()
                command.run()
              }}
            >
              <span className="palette-item-icon">{command.icon}</span>
              <span className="palette-item-label">{command.label}</span>
              {command.hint && <span className="palette-item-hint">{command.hint}</span>}
            </button>
          </li>
        ))}
      </ul>

      <footer className="palette-foot">
        <span className="palette-key">
          <CornerDownLeftIcon size={12} />
          Select
        </span>
        <span className="palette-key">↑ ↓ Navigate</span>
      </footer>
    </dialog>
  )
}
