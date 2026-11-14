/*
 * Interruptions, at the top right.
 *
 * A toast is two parts and the separator is a literal " — ": everything before it
 * is the headline, everything after is the detail. That keeps the call site a
 * single string, which is what makes the copy readable at the place it is
 * written.
 */

export interface Toast {
  id: number
  text: string
}

interface Props {
  toasts: Toast[]
  onDismiss: (id: number) => void
}

export default function Toasts({ toasts, onDismiss }: Props): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute right-4 top-14 z-50 flex w-[300px] flex-col gap-2">
      {toasts.map((toast) => {
        const [headline, ...rest] = toast.text.split(' — ')
        const detail = rest.join(' — ')

        return (
          <div
            key={toast.id}
            className="fade-up pointer-events-auto border border-[var(--hairline)] bg-[var(--color-surface)] px-3.5 py-2.5"
            style={{ borderRadius: 10, boxShadow: 'var(--lift), var(--sheen)' }}
            role="status"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11.5px] font-medium text-[var(--color-ink)]">{headline}</div>
                {detail ? (
                  <div className="mt-0.5 text-[10.5px] leading-[15px] text-[var(--color-ink-2)]">
                    {detail}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => onDismiss(toast.id)}
                className="-mr-1 -mt-1 grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--color-ink-3)] transition-colors duration-150 hover:text-[var(--color-ink)]"
              >
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path
                    d="M2 2l6 6M8 2L2 8"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
