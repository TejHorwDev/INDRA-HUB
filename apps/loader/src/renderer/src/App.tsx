import { useCallback, useEffect, useRef, useState } from 'react'
import type { InstallView, UpdateState } from '@shared/types'
import { lockedReason } from '@shared/access'
import type { LoaderApp, LoaderConfig } from '@shared/types'
import { bridge } from './lib/bridge'
import Splash from './screens/Splash'
import Landing from './screens/Landing'
import SignIn from './screens/SignIn'
import Verifying from './screens/Verifying'
import Dashboard from './screens/Dashboard'
import AppDetail from './screens/AppDetail'
import Settings from './screens/Settings'
import Dialog from './components/Dialog'
import Toasts, { type Toast } from './components/Toasts'

/*
 * The whole flow, in one place.
 *
 *   splash (4s) → landing → sign in → verifying → library ⇄ settings
 *
 * The auth call, the catalogue load and the entitlement lookup are owned here
 * and nowhere else, so there is exactly one place that knows what "signed in"
 * means and exactly one place that decides what a card may do.
 */

type Screen = 'splash' | 'landing' | 'signin' | 'verifying' | 'home' | 'settings'

const SPLASH_MS = 4_000
const MIN_VERIFY_MS = 1_300

const EMPTY_CONFIG: LoaderConfig = {
  website: '',
  instagram: '',
  tiktok: '',
  discord: '',
  youtube: ''
}

interface Confirmation {
  title: string
  body: string
  primary: string
  onPrimary: () => void
}

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('splash')
  const [error, setError] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)

  const [apps, setApps] = useState<LoaderApp[]>([])
  const [owned, setOwned] = useState<string[]>([])
  const [config, setConfig] = useState<LoaderConfig>(EMPTY_CONFIG)
  const [loading, setLoading] = useState(true)

  const [selected, setSelected] = useState<LoaderApp | null>(null)
  const [installs, setInstalls] = useState<Record<string, InstallView>>({})
  const [dialog, setDialog] = useState<Confirmation | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [version, setVersion] = useState<{ running: string; installed: string; packaged: boolean } | null>(
    null
  )
  const [busy, setBusy] = useState(false)

  const toastId = useRef(0)

  const toast = useCallback((text: string) => {
    const id = (toastId.current += 1)
    setToasts((current) => [...current.slice(-2), { id, text }])
    setTimeout(() => setToasts((current) => current.filter((entry) => entry.id !== id)), 4_200)
  }, [])

  useEffect(() => {
    const timer = setTimeout(
      () => setScreen((current) => (current === 'splash' ? 'landing' : current)),
      SPLASH_MS
    )
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    void bridge.version().then(setVersion)
    void bridge.updates.state().then(setUpdate)
    return bridge.updates.onState(setUpdate)
  }, [])

  useEffect(() => {
    void bridge.files.states().then(setInstalls)
    return bridge.files.onState(setInstalls)
  }, [])

  /*
   * While a detail panel is open on something installed, ask again every few
   * seconds. A launched process can exit at any moment and nothing tells the app
   * about it, so "Running" would otherwise stay on screen after the game closed.
   */
  useEffect(() => {
    if (!selected) return
    const timer = setInterval(() => {
      void bridge.files.states().then(setInstalls)
    }, 4_000)
    return () => clearInterval(timer)
  }, [selected])

  /** Catalogue, then entitlement. Both before the library is shown as loaded. */
  const loadLibrary = useCallback(async () => {
    setLoading(true)
    try {
      const [catalogue, ownedIds] = await Promise.all([
        bridge.catalogue.load(),
        bridge.auth.owned()
      ])
      setApps(catalogue.apps)
      setConfig(catalogue.config)
      setOwned(ownedIds)
    } finally {
      setLoading(false)
    }
  }, [])

  const submit = useCallback(
    (user: string, pass: string) => {
      setError(null)
      setScreen('verifying')

      const started = Date.now()
      void (async () => {
        const result = await bridge.auth.login(user, pass)

        // Never a flash: the spinner is on screen long enough to be read.
        const remaining = MIN_VERIFY_MS - (Date.now() - started)
        if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))

        if (!result.ok) {
          setError(result.error)
          setScreen('signin')
          return
        }

        setUsername(result.username)
        setScreen('home')
        await loadLibrary()
      })()
    },
    [loadLibrary]
  )

  const open = useCallback(
    (app: LoaderApp) => {
      const reason = lockedReason(app, owned)
      if (!reason) {
        setSelected(app)
        return
      }

      setDialog({
        title: reason === 'unavailable' ? 'Not available' : 'Licence required',
        body:
          reason === 'unavailable'
            ? `${app.name} is switched off at the moment. It will reappear here as soon as it is back.`
            : `${app.name} is not on your account yet. Licences are sold on the website.`,
        primary: 'Website',
        onPrimary: () => {
          setDialog(null)
          if (config.website) void bridge.links.open(config.website)
          else toast('No website yet — the link has not been published.')
        }
      })
    },
    [config.website, owned, toast]
  )

  const confirmExternal = useCallback((url: string) => {
    setDialog({
      title: 'Open website',
      body: `This opens ${url.replace(/^https?:\/\//, '').replace(/\/$/, '')} in your browser.`,
      primary: 'Continue',
      onPrimary: () => {
        setDialog(null)
        void bridge.links.open(url)
      }
    })
  }, [])

  async function runUpdate(work: () => Promise<UpdateState>): Promise<void> {
    setBusy(true)
    try {
      const state = await work()
      if (state.message) toast(state.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="silk shell">
      {screen === 'splash' ? <Splash /> : null}

      {screen === 'landing' ? (
        <Landing
          onStart={() => {
            setError(null)
            setScreen('signin')
          }}
          onExternal={confirmExternal}
        />
      ) : null}

      {screen === 'signin' ? (
        <SignIn onSubmit={submit} error={error} busy={false} onBack={() => setScreen('landing')} />
      ) : null}

      {screen === 'verifying' ? <Verifying /> : null}

      {screen === 'home' ? (
        <Dashboard
          apps={apps}
          owned={owned}
          installs={installs}
          config={config}
          username={username}
          loading={loading}
          onSettings={() => setScreen('settings')}
          onOpen={open}
          onLocked={open}
          onWebsite={() => (config.website ? confirmExternal(config.website) : undefined)}
        />
      ) : null}

      {screen === 'settings' && update ? (
        <Settings
          update={update}
          version={version}
          config={config}
          busy={busy}
          onBack={() => setScreen('home')}
          onCheck={() => void runUpdate(() => bridge.updates.check())}
          onInstall={() => void runUpdate(() => bridge.updates.install())}
          onOpen={confirmExternal}
        />
      ) : null}

      {selected ? (
        <AppDetail
          app={selected}
          onBack={() => setSelected(null)}
          install={installs[selected.id] ?? null}
          running={installs[selected.id]?.running ?? false}
          onCancel={() => void bridge.files.cancel(selected.id)}
          onReveal={() => void bridge.files.reveal(selected.id)}
          onDownload={() => {
            void bridge.files.download(selected.id).then((view) => {
              if (view.state === 'error') toast(`Download failed — ${view.error ?? 'try again.'}`)
              else if (view.state === 'installed') toast(`${selected.name} — downloaded and ready.`)
            })
          }}
          onLaunch={() => {
            void bridge.files.launch(selected.id).then((result) => {
              if (result.ok) {
                toast(`Launching — ${selected.name}`)
                void bridge.files.states().then(setInstalls)
              } else {
                toast(`Could not launch — ${result.error ?? 'unknown error'}`)
              }
            })
          }}
        />
      ) : null}

      {dialog ? (
        <Dialog
          title={dialog.title}
          body={dialog.body}
          primary={dialog.primary}
          onPrimary={dialog.onPrimary}
          onClose={() => setDialog(null)}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((t) => t.id !== id))} />
    </div>
  )
}
