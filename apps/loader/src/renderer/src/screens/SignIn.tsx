import { useEffect, useRef, useState } from 'react'
import Field from '../components/Field'
import SlideButton from '../components/SlideButton'
import WindowControls from '../components/WindowControls'

/*
 * Authenticate.
 *
 * Called that on the screen too, not "Sign in". The word on the button is the word
 * for what happens: a password is checked against an account, and "authenticate" is
 * what the thing on the other end is doing.
 *
 * Field positions come from the design: the two fields at x317, 266 wide, 42
 * tall, 54 apart, with the slider 58 below the second. The eye sits inside the
 * password field at x560.
 *
 * The form does not submit itself on Enter into a network call — it hands the
 * credentials up and the parent decides. That keeps the one place that talks to
 * the auth server the one place that owns the flow.
 */

interface Props {
  onBack: () => void
  onSubmit: (username: string, password: string) => void
  /** A sentence from the last attempt, shown under the fields. */
  error: string | null
  busy: boolean
}

export default function SignIn({ onBack, onSubmit, error, busy }: Props): React.JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const userRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    userRef.current?.focus()
  }, [])

  const ready = username.trim().length > 0 && password.length > 0

  function submit(): void {
    if (!ready || busy) return
    onSubmit(username, password)
  }

  return (
    <div className="absolute inset-0">
      <WindowControls />

      <button
        type="button"
        aria-label="Back"
        onClick={onBack}
        className="absolute grid h-10 w-10 place-items-center rounded-full border border-[var(--hairline)] bg-[var(--color-raised)]/70 text-[var(--color-ink-2)] transition-colors duration-150 hover:border-[var(--hairline-strong)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        style={{ left: 20, top: 14 }}
      >
        <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M7.5 2.5 4 6l3.5 3.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <h2
        className="fade-up absolute left-0 right-0 text-center text-[23px] leading-none"
        style={{ top: 112, color: '#ffffff', fontWeight: 600, letterSpacing: '0.01em' }}
      >
        Authenticate
      </h2>

      <p
        className="fade-up absolute left-0 right-0 text-center text-[12px] text-[var(--color-ink-2)]"
        style={{ top: 148, animationDelay: '50ms' }}
      >
        Use the username and password you registered.
      </p>

      {/*
        * No box.
        *
        * It was a rounded panel of translucent black with a border and a lift, and
        * the effect was a form pasted onto a picture. What is here instead is light:
        * one soft ellipse of shadow behind the fields, no edge to find and no corner
        * to read as a card. The video keeps going behind the whole screen.
        */}
      <div
        aria-hidden
        className="absolute left-1/2 -translate-x-1/2"
        style={{
          top: 96,
          width: 520,
          height: 360,
          background:
            'radial-gradient(58% 62% at 50% 52%, rgba(6,6,8,0.72) 0%, rgba(6,6,8,0.55) 46%, transparent 78%)',
          pointerEvents: 'none'
        }}
      />

      <div className="absolute" style={{ left: 317, top: 188 }}>
        <Field
          ref={userRef}
          width={266}
          height={42}
          placeholder="Username"
          autoComplete="username"
          spellCheck={false}
          value={username}
          disabled={busy}
          onChange={(event) => setUsername(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
        />
      </div>

      <div className="absolute" style={{ left: 317, top: 242 }}>
        <Field
          width={266}
          height={42}
          placeholder="Password"
          autoComplete="current-password"
          spellCheck={false}
          type={visible ? 'text' : 'password'}
          value={password}
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
          trailing={
            <button
              type="button"
              aria-label={visible ? 'Hide password' : 'Show password'}
              aria-pressed={visible}
              onClick={() => setVisible((value) => !value)}
              className="grid h-7 w-7 place-items-center rounded-full text-[var(--color-ink-3)] transition-colors duration-150 hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M1.6 8s2.3-3.9 6.4-3.9S14.4 8 14.4 8s-2.3 3.9-6.4 3.9S1.6 8 1.6 8Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
                <circle cx="8" cy="8" r="1.9" stroke="currentColor" strokeWidth="1.3" />
                {visible ? null : (
                  <path d="M2.4 13.6 13.6 2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                )}
              </svg>
            </button>
          }
        />
      </div>

      <div className="absolute" style={{ left: 317, top: 300 }}>
        <SlideButton
          label="Authenticate"
          width={266}
          height={40}
          disabled={!ready || busy}
          onConfirm={submit}
        />
      </div>

      {error ? (
        <p
          className="fade-up absolute text-center text-[11.5px] leading-[18px] text-[var(--color-danger)]"
          style={{ left: 317, top: 352, width: 266 }}
          role="alert"
        >
          {error}
        </p>
      ) : (
        <p
          className="absolute text-center text-[10.5px] leading-[18px] text-[var(--color-ink-3)]"
          style={{ left: 317, top: 352, width: 266 }}
        >
          Drag the slider to sign in.
        </p>
      )}

      <p
        className="absolute text-center text-[10px] text-[var(--color-ink-3)]"
        style={{ left: 317, top: 404, width: 266 }}
      >
        No account yet? Licences are sold on the website.
      </p>
    </div>
  )
}
