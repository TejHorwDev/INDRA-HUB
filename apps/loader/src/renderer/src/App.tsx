import { useCallback, useEffect, useRef, useState } from 'react'
import type { InstallView, UpdateState } from '@shared/types'
import { lockedReason } from '@shared/access'
import type { LoaderApp, LoaderConfig } from '@shared/types'
import { bridge } from './lib/bridge'
import Splash from './screens/Splash'
import Landing from './screens/Landing'
import SignIn from './screens/SignIn'
import Dashboard from './screens/Dashboard'
import AppDetail from './screens/AppDetail'
import Settings from './screens/Settings'
import Backdrop from './components/Backdrop'
import Preparing from './screens/Preparing'
import Dialog from './components/Dialog'
import Toasts, { type Toast } from './components/Toasts'
import UpdatePill from './components/UpdatePill'

/*
 * The whole flow, in one place.
 *
 *   splash (2s) → landing → sign in → one loading → library ⇄ settings
 *
 * The auth call, the catalogue load and the entitlement lookup are owned here
 * and nowhere else, so there is exactly one place that knows what "signed in"
 * means and exactly one place that decides what a card may do.
 */

type Screen = 'splash' | 'landing' | 'signin' | 'home' | 'settings'

/*
 * How long the library is held behind the curtain after a sign-in.
 *
 * This is the *whole* of the wait, from the moment Sign in is pressed — the login is
 * inside it, not in front of it. There used to be two loadings back to back: a verifying
 * spinner for the login and then the curtain for the library, the same circle twice with
 * a change of scenery in between. Watching it, that is one long stall. It is one screen
 * now, and it comes down once.
 *
 * Long enough that a card's video is already mid-loop when it appears — not long enough
 * to be a wait. The curtain never lifts before the catalogue, the entitlement and the
 * artwork have all landed; four and a half seconds is the number this was tuned to.
 */
const PREPARE_MS = 4_500

/** The ceiling on waiting for artwork. A slow bucket delays the reveal; it cannot block it. */
const ARTWORK_CEILING_MS = 4_000

const SPLASH_MS = 2_000

/**
 * When the single loading admits it is taking too long.
 *
 * The auth service is a Render instance that sleeps, and a first request after sleep can
 * take half a minute. A loading state that never says anything is indistinguishable from
 * a hung app, so after this long it says so — and offers the only useful thing left.
 */
const STALL_AFTER_MS = 12_000

/**
 * The longest anything may wait behind a spinner.
 *
 * The auth service is a Render instance that sleeps, and a request to a sleeping host
 * can take half a minute — so the wait is generous. It is not infinite: at this point
 * the screen says what happened and offers the only useful thing left, which is to try
 * again. A spinner that never ends is worse than a failure that does.
 */
const WAIT_CAP_MS = 25_000

function withCap<T>(work: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    work.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), WAIT_CAP_MS))
  ])
}

const EMPTY_CONFIG: LoaderConfig = {
  website: '',
  video: '',
  notice: '',
  maintenance: false,
  filmBlur: 0,
  filmDim: 0
}

/*
 * Every card's artwork, fetched once and kept in the browser's cache.
 *
 * The library is a grid of pictures, and without this each one begins downloading when
 * its card mounts — so the screen paints in the order the cards were rendered, art
 * arriving behind the names. Asking for them all the moment the catalogue is known means
 * the cards are already painted by the time they slide in. The API serves them immutable,
 * because every upload gets a new address, so the second launch fetches nothing.
 *
 * A GIF is included: it animates in an `<img>` like any other picture, and warming it is
 * what stops the card flickering from a still frame into motion.
 */
const MOVING_ARTWORK = /\.(mp4|webm|mov|m4v)(\?|#|$)/i

/* One warm per address, ever. The catalogue can be reloaded; the bytes cannot. */
const warmed = new Set<string>()

function warmImages(apps: LoaderApp[]): Promise<void> {
  const jobs: Array<Promise<unknown>> = []

  for (const app of apps) {
    if (!app.image || warmed.has(app.image)) continue
    warmed.add(app.image)

    if (MOVING_ARTWORK.test(app.image)) {
      /*
       * A video card, pulled into the HTTP cache before its card is ever drawn.
       *
       * Skipping videos was right when a card warmed itself by starting — but "starting"
       * means the first second of a clip is spent buffering, and on a grid that is a
       * visible moment of black where the artwork should be. Fetching the bytes first
       * costs nothing extra (the address is immutable, so this is the same request the
       * element would have made) and turns "play" into "already playing".
       */
      jobs.push(
        fetch(app.image, { cache: 'force-cache' })
          .then((response) => response.blob())
          .catch(() => undefined)
      )
      continue
    }

    jobs.push(
      new Promise<void>((resolve) => {
        const image = new Image()
        image.decoding = 'async'
        image.onload = () => {
          /*
           * `decode()` is the difference between "the file is here" and "the picture is
           * ready to paint". Without it the card still spends a frame decoding when it
           * mounts, which is exactly the moment the curtain lifts.
           */
          void image.decode().then(() => resolve(), () => resolve())
        }
        image.onerror = () => resolve()
        image.src = app.image
      })
    )
  }

  return Promise.all(jobs).then(() => undefined)
}

interface Confirmation {
  title: string
  body: string
  primary: string
  onPrimary: () => void
}

/*
 * Installed builds open behind the launch card, which has already been the
 * splash. Replaying the two-second opening after it would be two waits in a row,
 * so the renderer starts where the card leaves off.
 */
const LAUNCHED_BY_CARD = new URLSearchParams(window.location.search).get('card') === '1'

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>(LAUNCHED_BY_CARD ? 'landing' : 'splash')
  const [error, setError] = useState<string | null>(null)

  const [apps, setApps] = useState<LoaderApp[]>([])
  const [owned, setOwned] = useState<string[]>([])
  const [config, setConfig] = useState<LoaderConfig>(EMPTY_CONFIG)
  /*
   * The film, as the backdrop should play it.
   *
   * Separate from `config.video`, which is the address the panel published. When the film
   * has been fetched once it lives on disk, and this is the `indra-film://` address for
   * that file — no network, no waiting. It is asked for at mount, before anything is
   * fetched from the network, so the first paint can already have a picture behind it.
   */
  const [film, setFilm] = useState('')
  const [loading, setLoading] = useState(true)
  /*
   * The one loading state in the app.
   *
   * `preparing` holds it from the moment Sign in is pressed — login, catalogue,
   * entitlement and artwork all happen underneath it — and `lifting` fades it. The grid
   * mounts as it lifts: the cards arrive with their artwork already decoded and their
   * clips already cached, so there is nothing left to assemble in front of you, and
   * nothing spending a decoder while the circle above needs the machine.
   */
  const [curtain, setCurtain] = useState<'idle' | 'preparing' | 'lifting'>('idle')

  /** The one loading has been up long enough to say so. See STALL_AFTER_MS. */
  const [stalled, setStalled] = useState(false)

  /** Which sign-in attempt is current. Anything older is not allowed to finish. */
  const attempt = useRef(0)

  const [selected, setSelected] = useState<LoaderApp | null>(null)
  const [installs, setInstalls] = useState<Record<string, InstallView>>({})
  const [dialog, setDialog] = useState<Confirmation | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [version, setVersion] = useState<{
    running: string
    installed: string
    packaged: boolean
    updated?: string | null
  } | null>(null)
  const [busy, setBusy] = useState(false)

  const toastId = useRef(0)

  const toast = useCallback((text: string) => {
    const id = (toastId.current += 1)
    setToasts((current) => [...current.slice(-2), { id, text }])
    setTimeout(() => setToasts((current) => current.filter((entry) => entry.id !== id)), 4_200)
  }, [])

  /*
   * A product replaced itself.
   *
   * The replacement happens in about a second, in the background, on a screen nobody is
   * looking at — which is exactly right, and made it invisible: the card says DOWNLOADED
   * before and after, so the only evidence was a file's timestamp. One line, once, when
   * it lands.
   */
  useEffect(
    () =>
      bridge.files.onUpdated(({ name, version }) =>
        toast(`${name} updated — v${version} is now on this machine`)
      ),
    [toast]
  )

  useEffect(() => {
    const timer = setTimeout(
      () => setScreen((current) => (current === 'splash' ? 'landing' : current)),
      SPLASH_MS
    )
    return () => clearTimeout(timer)
  }, [])

  /*
   * The updater decides whether it may restart silently, and it can only do that
   * if it knows what is on screen. It never renders anything from this; it is a
   * single string on the other side of the bridge.
   */
  useEffect(() => {
    bridge.updates.screen(screen)
  }, [screen])

  /*
   * And what is *in hand* on that screen.
   *
   * The updater used to decide whether it could restart by looking at the screen
   * name, so an empty sign-in form and half a typed password counted as the same
   * thing — and the library counted as busy forever, which is why an update
   * downloaded at launch could sit on disk all day. A field having focus or text is
   * the fact that actually matters, and only the window knows it.
   */
  useEffect(() => {
    const report = (): void => {
      const active = document.activeElement
      const typing =
        active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      bridge.updates.activity({ screen, typing })
    }
    report()
    document.addEventListener('focusin', report)
    document.addEventListener('focusout', report)
    window.addEventListener('blur', report)
    return () => {
      document.removeEventListener('focusin', report)
      document.removeEventListener('focusout', report)
      window.removeEventListener('blur', report)
    }
  }, [screen])

  useEffect(() => {
    void bridge.version().then((info) => {
      setVersion(info)
      /*
       * An update that installs itself and then shows a sign-in form is
       * indistinguishable from one that never happened — which is exactly how it was
       * reported. So when this launch came from the updater, it says so once.
       */
      if (info.updated) toast(`Updated to ${info.updated}.`)
    })
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

  /*
   * What the catalogue says about itself — the website link and the backdrop film.
   *
   * Loaded on mount, before anybody signs in, because both of them belong to the
   * screens that come *before* the library. Fetching them after a successful login
   * meant the sign-in page never had a video to play: the setting arrived one screen
   * too late, which is exactly how a working feature looks broken.
   */
  /*
   * First: the film from the disk. One IPC round trip against a local file, which is
   * fast enough to beat the first frame.
   */
  useEffect(() => {
    void bridge.media
      .film()
      .then((cached) => {
        if (cached) setFilm(cached)
      })
      .catch(() => undefined)

    // A new film was published, or the one being downloaded has landed.
    return bridge.media.onFilm((source) => setFilm(source))
  }, [])

  useEffect(() => {
    void bridge.catalogue
      .load()
      .then((catalogue) => {
        setApps(catalogue.apps)
        setConfig(catalogue.config)
        void warmImages(catalogue.apps)
      })
      // The film and the links are the two things this feeds, and both have sane
      // defaults. A failed read must not become an unhandled rejection.
      .catch(() => undefined)
  }, [])

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
      // Returned so the caller can wait for the artwork before lifting the curtain.
      return catalogue
    } finally {
      setLoading(false)
    }
  }, [])

  const submit = useCallback(
    (user: string, pass: string) => {
      setError(null)

      /*
       * One loading, starting now.
       *
       * The curtain goes up the instant Sign in is pressed and does not come down until
       * both the login and the library behind it are done. It used to be two screens —
       * verifying, then the curtain — and two of the same circle with a change of scenery
       * between them is read as one stall, which is exactly what it was.
       */
      setScreen('home')
      setCurtain('preparing')
      setStalled(false)

      const run = attempt.current + 1
      attempt.current = run
      const opened = Date.now()
      const stall = window.setTimeout(() => setStalled(true), STALL_AFTER_MS)

      /** Only the newest attempt may finish. A second sign-in abandons the first. */
      const live = (): boolean => attempt.current === run

      const fail = (message: string): void => {
        if (!live()) return
        window.clearTimeout(stall)
        setStalled(false)
        setCurtain('idle')
        setError(message)
        setScreen('signin')
      }

      void (async () => {
        // Capped, and caught. A rejected IPC call used to leave the screen up forever
        // with no way back, because nothing in the chain had a `catch`.
        const result = await withCap(bridge.auth.login(user, pass), {
          ok: false,
          error: 'Connection failed'
        })

        if (!live()) return
        if (!result.ok) return fail(result.error)

        // A library that fails to load must not take the app down with it; the film is
        // already on screen and the host is already reachable or not.
        const catalogue = await loadLibrary().catch(() => null)
        if (!live()) return

        /*
         * Then the artwork, under the circle.
         *
         * This is the whole point of the loading state, and the reason it exists at all:
         * an image that decodes while nobody is looking costs nothing, and a card that
         * arrives with its picture already finished does not assemble itself in front of
         * you. Bytes and decodes only — no element is mounted, because a decoder is a
         * decoder and the circle above has to have the machine.
         */
        if (catalogue) {
          await Promise.race([
            warmImages(catalogue.apps),
            new Promise((resolve) => setTimeout(resolve, ARTWORK_CEILING_MS))
          ])
        }
        if (!live()) return

        // The floor on the whole thing, counted from the press rather than from the
        // login, so there is one wait and it is four and a half seconds long.
        const hold = PREPARE_MS - (Date.now() - opened)
        if (hold > 0) await new Promise((resolve) => setTimeout(resolve, hold))
        if (!live()) return

        window.clearTimeout(stall)
        setStalled(false)
        setCurtain('lifting')
        window.setTimeout(() => {
          if (live()) setCurtain('idle')
        }, 760)
      })().catch((error: unknown) => {
        fail(error instanceof Error ? error.message : 'Connection failed')
      })
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
      {/*
        * The film belongs to the window, not to a screen.
        *
        * It was on the sign-in page only, which meant somebody looking at the
        * landing page — or the library, or settings — saw a plain background and
        * concluded the video was broken. One layer, under everything, for the whole
        * life of the window.
        */}
      {/*
        * The cached film first, the published address only as a fallback for the launch
        * that has never had one. Reading `config.video` alone meant the backdrop waited
        * for the catalogue, and then for a bucket, before a single frame appeared.
        */}
      <Backdrop video={film || config.video || undefined} blur={config.filmBlur} dim={config.filmDim} />

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
        <SignIn
          onSubmit={submit}
          error={error}
          busy={false}
          onBack={() => setScreen('landing')}
        />
      ) : null}

      {/*
        * Maintenance closes the door without taking the app away: the header stays,
        * so the window is still the loader and still has window controls, and the
        * sentence says whose decision this was. Nobody should have to guess whether
        * an empty library means they own nothing or that we are working on it.
        */}
      {screen === 'home' && config.maintenance && curtain === 'idle' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.28em] text-[var(--color-ink-3)]">
            Indra Loader
          </div>
          <div className="mt-3 text-[19px] leading-tight">Down for maintenance</div>
          <p className="mt-2 max-w-[420px] text-[11.5px] leading-[1.7] text-[var(--color-ink-2)]">
            {config.notice ||
              'The catalogue is being updated. Nothing is lost — reopen in a few minutes.'}
          </p>
        </div>
      ) : null}

      {/*
        * The library steps aside while a product is open.
        *
        * The detail overlay used to paint over it — an opaque sheet, which is why the
        * film stopped there. Without that sheet the two screens would be stacked on top
        * of each other, so the one underneath is simply not rendered: the detail has the
        * window to itself, and the film runs behind it like everywhere else.
        */}
      {screen === 'home' && !config.maintenance && !selected && curtain !== 'preparing' ? (
        /*
         * The grid is mounted as the curtain lifts, not before it.
         *
         * It used to be mounted underneath at zero opacity, on the theory that a hidden
         * element still paints. It does — and that is the problem: three card videos plus
         * the film decode at once, the machine has nothing left for the spinner, and the
         * circle visibly steps. The bytes are already in the cache by now, so mounting
         * here costs a frame, not a download.
         */
        <div className="library-stage">
          <Dashboard
            apps={apps}
            owned={owned}
            installs={installs}
            config={config}
            loading={loading}
            onSettings={() => setScreen('settings')}
            onOpen={open}
            onLocked={open}
            onWebsite={() => (config.website ? confirmExternal(config.website) : undefined)}
          />
        </div>
      ) : null}

      {/* The curtain sits above the grid it is covering, and above nothing else. */}
      {curtain === 'idle' ? null : (
        <Preparing
          out={curtain === 'lifting'}
          stalled={stalled}
          onBack={() => {
            attempt.current += 1
            setStalled(false)
            setCurtain('idle')
            setError(null)
            setScreen('signin')
          }}
        />
      )}

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
          onSignOut={() => {
            /*
             * The one way out of a remembered session. Without it, an app that
             * restored itself after an update had no sign-out anywhere in it.
             */
            void bridge.auth.logout().then(() => {
              setSelected(null)
              setOwned([])
              setError(null)
              setScreen('signin')
            })
          }}
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

      {/*
        * An update that lands while somebody is using the app is offered rather
        * than applied: the silent restart only happens before the first screen
        * has been left. Never shown over the splash or the sign-in form.
        */}
      {screen === 'home' || screen === 'settings' ? (
        <UpdatePill update={update} onInstall={() => void bridge.updates.install()} />
      ) : null}

      {/*
        * The only drag region in the app. Last in the tree so it sits above the
        * screens, and short of the window controls so they still take clicks.
        */}
      <div className="drag-strip" />

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((t) => t.id !== id))} />
    </div>
  )
}
