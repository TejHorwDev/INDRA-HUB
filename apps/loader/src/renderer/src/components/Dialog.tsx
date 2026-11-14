import { useEffect } from 'react'

/*
 * A centred confirmation, 420x200.
 *
 * One dialog for every interruption, so the app has exactly one way of asking
 * something. Escape cancels, the primary action is focused on open, and the
 * backdrop blurs the app behind it rather than blacking it out — the context is
 * still legible.
 */

interface Props {
  title: string
  body: string
  primary: string
  secondary?: string
  onPrimary: () => void
  onClose: () => void
}

export default function Dialog({
  title,
  body,
  primary,
  secondary = 'Cancel',
  onPrimary,
  onClose
}: Props): React.JSX.Element {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="absolute inset-0 z-40 grid place-items-center bg-[#07070a]/60 backdrop-blur-[6px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fade-up flex flex-col border border-[var(--hairline)] bg-[var(--color-surface)] p-5"
        style={{ width: 420, height: 200, borderRadius: 14, boxShadow: 'var(--lift), var(--sheen)' }}
      >
        <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">{title}</h3>
        <p className="mt-2 flex-1 text-[11.5px] leading-[18px] text-[var(--color-ink-2)]">{body}</p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-[var(--hairline)] bg-[var(--color-raised)] px-3 text-[11.5px] text-[var(--color-ink-2)] transition-colors duration-150 hover:border-[var(--hairline-strong)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            {secondary}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onPrimary}
            className="h-8 rounded-md bg-gradient-to-b from-[#ffffff] to-[#d6d6db] px-3 text-[11.5px] font-medium text-[#0b0a0f] transition-[filter] duration-150 hover:brightness-[1.05] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            {primary}
          </button>
        </div>
      </div>
    </div>
  )
}
