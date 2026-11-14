import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn'
import { AlertCircleIcon } from './icons'

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  /** Message rendered next to the field; takes precedence over `hint`. */
  error?: string | null
  /** Helper content (e.g. a strength meter) rendered when there is no error. */
  hint?: ReactNode
  /** Right-aligned slot on the label row, e.g. "Forgot password?". */
  labelAccessory?: ReactNode
  /** Absolutely positioned control inside the input, e.g. show/hide password. */
  trailing?: ReactNode
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, labelAccessory, trailing, id, className, ...inputProps },
  ref
) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const messageId = `${inputId}-message`
  const showError = Boolean(error)

  return (
    <div>
      <div className="field-label">
        <label htmlFor={inputId}>{label}</label>
        {labelAccessory}
      </div>

      <div className="relative">
        <input
          {...inputProps}
          id={inputId}
          ref={ref}
          aria-invalid={showError || undefined}
          aria-describedby={showError || hint ? messageId : undefined}
          className={cn('field-input', trailing ? 'field-input--padded' : undefined, className)}
        />
        {trailing}
      </div>

      {showError ? (
        <p id={messageId} className="field-message" role="alert">
          <AlertCircleIcon size={13} />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <div id={messageId}>{hint}</div>
      ) : null}
    </div>
  )
})

export default TextField
