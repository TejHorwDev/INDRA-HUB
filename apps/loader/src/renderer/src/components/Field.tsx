import { forwardRef } from 'react'

/*
 * A text field.
 *
 * Focus is a hairline going from 7% to 40% accent — no halo, no glow, no ring
 * outside the control. The caret is the accent colour because it is the only
 * place a caret can be.
 */

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  width: number
  height?: number
  trailing?: React.ReactNode
}

const Field = forwardRef<HTMLInputElement, Props>(function Field(
  { width, height = 42, trailing, className = '', ...rest },
  ref
) {
  return (
    <div
      className="relative flex items-center border border-[var(--hairline)] bg-[var(--color-raised)] transition-colors duration-150 focus-within:border-[rgba(167,155,199,0.4)]"
      style={{ width, height, borderRadius: 10 }}
    >
      <input
        ref={ref}
        {...rest}
        className={[
          'h-full w-full bg-transparent px-3.5 text-[12.5px] text-[var(--color-ink)]',
          'placeholder:text-[var(--color-ink-3)] focus:outline-none',
          'caret-[var(--color-accent)] selection:bg-[rgba(167,155,199,0.25)]',
          className
        ].join(' ')}
        style={{ borderRadius: 10 }}
      />
      {trailing ? <div className="absolute right-2.5 flex items-center">{trailing}</div> : null}
    </div>
  )
})

export default Field
