import { forwardRef } from 'react'

/*
 * A text field, drawn as a line rather than a box.
 *
 * The sign-in screen sits on a film now, and a rounded rectangle is an object: three
 * of them stacked in the middle of the window turned the page into a form on top of a
 * picture. A hairline under the text reads as a place to type without adding anything
 * to look at — the field is the line and the words on it.
 *
 * Focus is the same line getting brighter and the caret, which is already the
 * brightest thing in an input. No halo, no ring, no glow.
 */

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  width: number
  height?: number
  trailing?: React.ReactNode
}

const Field = forwardRef<HTMLInputElement, Props>(function Field(
  { width, height = 44, trailing, className = '', ...rest },
  ref
) {
  return (
    <div
      className="relative flex items-center border-b border-[rgba(255,255,255,0.16)] transition-colors duration-200 focus-within:border-[rgba(255,255,255,0.6)]"
      style={{ width, height }}
    >
      <input
        ref={ref}
        {...rest}
        className={[
          'h-full w-full bg-transparent pb-[3px] pr-9 pt-2 text-[13px] text-[var(--color-ink)]',
          'placeholder:text-[var(--color-ink-3)] focus:outline-none',
          'caret-[var(--color-accent)] selection:bg-[rgba(255,255,255,0.22)]',
          className
        ].join(' ')}
      />
      {trailing ? (
        <div className="absolute inset-y-0 right-0 flex items-center pb-[3px]">{trailing}</div>
      ) : null}
    </div>
  )
})

export default Field
