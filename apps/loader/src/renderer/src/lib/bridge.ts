import type {
  Catalogue,
  InstallView,
  LoaderBridge,
  SessionInfo,
  UpdateState
} from '@shared/types'

/*
 * The bridge, or a stand-in for it.
 *
 * The renderer is one React app that runs in two places: inside Electron, where
 * `window.loader` is real, and in a plain browser, where it is not. The second
 * mode exists so the interface can be looked at — and motion judged — without
 * building or installing anything. It renders the same components with the same
 * CSS in the same 900x550 frame; only the data behind them is staged.
 *
 * Nothing here ships as behaviour in the installed app: `window.loader` is
 * always present there.
 */

const idle: UpdateState = {
  phase: 'unsupported',
  currentVersion: '1.0.0',
  installedVersion: '1.0.0',
  version: null,
  percent: 0,
  bytesPerSecond: 0,
  message: 'Preview — the updater only runs in the installed app.',
  detail: null,
  checkedAt: null,
  canCheck: false,
  canInstall: false
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let mockSession: SessionInfo | null = null

/*
 * Staged catalogue for the preview.
 *
 * These are not demo apps shipped in the product — the installed app reads
 * `INDRA_LOADER_API` and shows a real, empty state until something is published.
 * They exist so the composition, the paging and the two lock states can be judged
 * in a browser before the API exists.
 */
const staged: Catalogue = {
  apps: [
    {
      id: 'mock-aurora',
      name: 'Aurora',
      description: 'Visual overhaul and quality-of-life layer. Free for every member.',
      version: '2.4.1',
      image: '',
      fileUrl: 'https://example.invalid/aurora.exe',
      keyauthAppId: '',
      sha256: '',
      status: 'active'
    },
    {
      id: 'mock-nova',
      name: 'Nova',
      description: 'Movement and aim assistance for ranked play. Licensed separately.',
      version: '1.9.0',
      image: '',
      fileUrl: 'https://example.invalid/nova.exe',
      keyauthAppId: 'mock-nova',
      sha256: '',
      status: 'active'
    },
    {
      id: 'mock-vantage',
      name: 'Vantage',
      description: 'Under maintenance while the season changes over.',
      version: '0.8.3',
      image: '',
      fileUrl: 'https://example.invalid/vantage.exe',
      keyauthAppId: '',
      sha256: '',
      status: 'locked'
    }
  ],
  config: { website: 'https://indra-cheats.com', video: '', notice: '', maintenance: false }
}

/*
 * A download that behaves like the real one, without a network or a disk.
 *
 * Three seconds, a progress curve, and the same two endings the service has: an
 * install, or a cancel. It exists so the action row's states can be looked at —
 * which is the only reason the preview exists at all.
 */
function filesMock(): LoaderBridge['files'] {
  const views = new Map<string, InstallView>()
  const timers = new Map<string, ReturnType<typeof setInterval>>()
  const listeners = new Set<(states: Record<string, InstallView>) => void>()

  const snapshot = (): Record<string, InstallView> => Object.fromEntries(views)
  const publish = (): void => {
    const states = snapshot()
    for (const listener of listeners) listener(states)
  }

  const set = (id: string, patch: Partial<InstallView>): void => {
    const current: InstallView = views.get(id) ?? {
      id,
      state: 'absent',
      running: false,
      percent: 0,
      received: 0,
      total: 0,
      bytesPerSecond: 0,
      error: null
    }
    views.set(id, { ...current, ...patch })
    publish()
  }

  function stop(id: string): void {
    const timer = timers.get(id)
    if (timer) clearInterval(timer)
    timers.delete(id)
  }

  return {
    states: async () => snapshot(),
    onState: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    download: (id) => {
      stop(id)
      set(id, { state: 'downloading', percent: 0, received: 0, total: 42_000_000, error: null })

      return new Promise((resolve) => {
        const total = 42_000_000
        const started = Date.now()
        const timer = setInterval(() => {
          const elapsed = Date.now() - started
          const percent = Math.min(99, Math.round((elapsed / 2_800) * 100))
          if (Date.now() - started >= 2_800) {
            stop(id)
            set(id, { state: 'installed', percent: 100, received: total, bytesPerSecond: 0 })
            resolve(views.get(id) as InstallView)
            return
          }
          set(id, {
            state: 'downloading',
            percent,
            received: Math.round((total * percent) / 100),
            bytesPerSecond: 18_000_000
          })
        }, 120)
        timers.set(id, timer)
      })
    },
    cancel: async (id) => {
      stop(id)
      set(id, { state: 'absent', percent: 0, received: 0, bytesPerSecond: 0 })
      return views.get(id) as InstallView
    },
    uninstall: async (id) => {
      stop(id)
      set(id, { state: 'absent', percent: 0, received: 0, bytesPerSecond: 0 })
      return views.get(id) as InstallView
    },
    launch: async (id) =>
      views.get(id)?.state === 'installed'
        ? { ok: true }
        : { ok: false, error: 'That application is not installed on this machine.' },
    reveal: async () => undefined
  }
}

const mock: LoaderBridge = {
  version: async () => ({ running: '1.0.0', installed: '1.0.0', packaged: false }),

  updates: {
    state: async () => idle,
    check: async () => idle,
    install: async () => idle,
    log: async () => [],
    diagnose: async () => ({
      steps: [{ label: 'Preview', ok: true, detail: 'not available in the browser preview' }],
      latestVersion: null,
      ok: true,
      summary: 'Preview mode — the updater runs in the installed app.'
    }),
    screen: () => undefined,
    onState: () => () => undefined
  },

  catalogue: {
    load: async () => staged
  },

  auth: {
    probe: async () => ({ ok: true, status: 200, count: 1, ids: ['mock-nova'], error: null }),
    owned: async () => ['mock-nova'],
    login: async (username, password) => {
      // Long enough to see the verifying screen, and honest about failures: the
      // word "wrong" in the password fails the way the server would.
      await wait(1_400)
      if (!username.trim() || !password) return { ok: false, error: 'Enter username & password' }
      if (/wrong|fail/i.test(password)) {
        return { ok: false, error: 'Invalid username or password' }
      }
      mockSession = { username: username.trim(), expires: null }
      return { ok: true, username: mockSession.username, expires: null }
    },
    logout: async () => {
      mockSession = null
    },
    session: async () => mockSession
  },

  files: filesMock(),

  links: {
    open: async (url) => {
      // A preview is still a real browser: the link works there too.
      if (/^https:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
    }
  },

  window: {
    close: () => undefined,
    minimize: () => undefined
  }
}

export const isPreview = typeof window === 'undefined' || !window.loader

export const bridge: LoaderBridge = (typeof window !== 'undefined' && window.loader) || mock
