import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/types'
import Splash from './screens/Splash'
import BuildPanel from './screens/BuildPanel'

/*
 * Stage 0 — the shell, the identity and the update pipeline.
 *
 * The splash runs for its full four seconds, then hands over to a build panel.
 * The panel is temporary: it exists so the updater can be proved on a real
 * installed copy before any of the product screens are built on top of it.
 * It is replaced by the landing page in stage 2, and nothing else changes.
 */

const SPLASH_MS = 4_000

export default function App(): React.JSX.Element {
  const [splash, setSplash] = useState(true)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [version, setVersion] = useState<{ running: string; installed: string; packaged: boolean } | null>(
    null
  )

  useEffect(() => {
    const timer = setTimeout(() => setSplash(false), SPLASH_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const bridge = window.loader
    if (!bridge) return

    void bridge.version().then(setVersion)
    void bridge.updates.state().then(setUpdate)
    return bridge.updates.onState(setUpdate)
  }, [])

  return (
    <div className="silk shell">
      {splash || !update ? <Splash /> : <BuildPanel update={update} version={version} />}
    </div>
  )
}
