import { useCallback, useEffect, useState } from 'react'
import type { UpdateState } from '@shared/types'
import { bridge } from './lib/bridge'
import Splash from './screens/Splash'
import Landing from './screens/Landing'
import SignIn from './screens/SignIn'
import Verifying from './screens/Verifying'
import BuildPanel from './screens/BuildPanel'

/*
 * The flow.
 *
 *   splash (4s) → landing → sign in → verifying → signed in
 *
 * The splash is a fixed four seconds on purpose: it is the app arriving, not a
 * loader. Verifying holds for at least 1.3 seconds even when the answer is
 * instant, because a flash of motion reads as a glitch rather than as work.
 *
 * The auth call is owned here and nowhere else, which is what keeps the token in
 * one process and the failure sentence in one place.
 */

type Screen = 'splash' | 'landing' | 'signin' | 'verifying' | 'ready'

const SPLASH_MS = 4_000
const MIN_VERIFY_MS = 1_300

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('splash')
  const [error, setError] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [version, setVersion] = useState<{ running: string; installed: string; packaged: boolean } | null>(
    null
  )

  useEffect(() => {
    const timer = setTimeout(() => setScreen((current) => (current === 'splash' ? 'landing' : current)), SPLASH_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    void bridge.version().then(setVersion)
    void bridge.updates.state().then(setUpdate)
    return bridge.updates.onState(setUpdate)
  }, [])

  const submit = useCallback((user: string, pass: string) => {
    setError(null)
    setScreen('verifying')

    const started = Date.now()
    void (async () => {
      const result = await bridge.auth.login(user, pass)

      // Never a flash: the spinner is on screen long enough to be read.
      const remaining = MIN_VERIFY_MS - (Date.now() - started)
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))

      if (result.ok) {
        setUsername(result.username)
        setScreen('ready')
      } else {
        setError(result.error)
        setScreen('signin')
      }
    })()
  }, [])

  return (
    <div className="silk shell">
      {screen === 'splash' ? <Splash /> : null}
      {screen === 'landing' ? (
        <Landing
          onStart={() => {
            setError(null)
            setScreen('signin')
          }}
        />
      ) : null}
      {screen === 'signin' ? (
        <SignIn
          onBack={() => setScreen('landing')}
          onSubmit={submit}
          error={error}
          busy={false}
        />
      ) : null}
      {screen === 'verifying' ? <Verifying /> : null}
      {screen === 'ready' && update ? (
        <BuildPanel update={update} version={version} username={username} />
      ) : null}
    </div>
  )
}
