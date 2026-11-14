/*
 * One button, three skins.
 *
 * Focus is a hairline, not a halo: the whole app keeps its ring inside the
 * border so nothing ever glows.
 */

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'solid' | 'ghost' | 'success'
}

const SKINS: Record<NonNullable<Props['variant']>, string> = {
  solid:
    'bg-gradient-to-b from-[#ffffff] to-[#d6d6db] text-[#0a0a0c] hover:from-[#ffffff] hover:to-[#e2e2e6]',
  ghost:
    'border border-[var(--hairline)] bg-[var(--color-raised)] text-[var(--color-ink)] hover:border-[var(--hairline-strong)] hover:bg-[#17171b]',
  success: 'bg-[var(--color-success)] text-[#06110d] hover:brightness-[1.06]'
}

export default function Button({
  variant = 'ghost',
  className = '',
  ...rest
}: Props): React.JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      className={[
        'no-drag inline-flex h-7 items-center justify-center rounded-md px-3 text-[11.5px] font-medium',
        'transition-[background,color,border-color,filter] duration-150',
        'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
        'disabled:pointer-events-none disabled:opacity-40',
        SKINS[variant],
        className
      ].join(' ')}
    />
  )
}
