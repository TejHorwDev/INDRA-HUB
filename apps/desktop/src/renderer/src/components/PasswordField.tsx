import { forwardRef, useState } from 'react'
import TextField from './TextField'
import type { TextFieldProps } from './TextField'
import { EyeIcon, EyeOffIcon } from './icons'

type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'trailing'>

const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
  props,
  ref
) {
  const [visible, setVisible] = useState(false)

  return (
    <TextField
      {...props}
      ref={ref}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          className="field-adornment"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
        </button>
      }
    />
  )
})

export default PasswordField
