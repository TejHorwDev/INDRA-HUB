import type { LoaderConfig, UpdateState } from '@shared/types'
import WindowControls from '../components/WindowControls'
import Button from '../components/Button'

/*
 * Settings.
 *
 * The update section is the reason this screen exists: it is where an installed
 * copy is brought forward, and it has to be legible to someone who has never
 * thought about an updater. Version, what is happening, and one button that does
 * the next thing.
 *
 * Everything here is real data from the updater — no invented "last checked"
 * timestamps, and no success message when a check failed.
 */

interface Props {
  update: UpdateState
  version: { running: string; installed: string; packaged: boolean } | null
  config: LoaderConfig
  busy: boolean
  onBack: () => void
  onCheck: () => void
  onInstall: () => void
  onOpen: (url: string) => void
}

const PHASE_TITLE: Record<UpdateState['phase'], string> = {
  unsupported: 'Not available here',
  idle: 'Not checked yet',
  checking: 'Checking…',
  'up-to-date': 'Up to date',
  available: 'Update found',
  downloading: 'Downloading',
  ready: 'Ready to install',
  error: 'Check failed'
}

export default function Settings({
  update,
  version,
  config,
  busy,
  onBack,
  onCheck,
  onInstall,
  onOpen
}: Props): React.JSX.Element {
  // One link, and only if it is published. The social channels were removed from
  // the app entirely: nothing here should send somebody to Instagram.
  const links = config.website ? [{ label: 'Website', url: config.website }] : []

  return (
    <div className="absolute inset-0">
      <button
        type="button"
        aria-label="Back"
        onClick={onBack}
        className="absolute grid h-7 w-7 place-items-center rounded-full border border-[var(--hairline)] bg-[var(--color-raised)] text-[var(--color-ink-2)] transition-colors duration-150 hover:border-[var(--hairline-strong)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        style={{ left: 24, top: 16 }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M7.5 2.5 4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <WindowControls />

      <h2 className="wordmark fade-up absolute left-0 right-0 text-center text-[23px] leading-none" style={{ top: 104 }}>
        Settings
      </h2>

      <div className="absolute flex flex-col gap-3" style={{ left: 88, top: 150, width: 724 }}>
        <section
          className="border border-[var(--hairline)] bg-[var(--color-surface)] p-4"
          style={{ borderRadius: 14, boxShadow: 'var(--sheen)' }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-[var(--color-ink)]">Updates</div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-ink-2)]">
                <span
                  className={
                    'h-1.5 w-1.5 rounded-full ' +
                    (update.phase === 'error'
                      ? 'bg-[var(--color-danger)]'
                      : update.phase === 'ready'
                        ? 'bg-[var(--color-success)]'
                        : 'bg-[var(--color-accent)]')
                  }
                />
                <span>{PHASE_TITLE[update.phase]}</span>
                <span className="text-[var(--color-ink-3)]">·</span>
                <span className="font-mono text-[10.5px] text-[var(--color-ink-3)]">
                  {version?.running ?? '—'}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" disabled={busy || !update.canCheck} onClick={onCheck}>
                Check for updates
              </Button>
              {update.canInstall ? (
                <Button variant="solid" disabled={busy} onClick={onInstall}>
                  Restart to apply
                </Button>
              ) : null}
            </div>
          </div>

          {update.phase === 'downloading' || update.phase === 'available' ? (
            <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-white/6">
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-200"
                style={{ width: `${Math.max(4, update.percent)}%` }}
              />
            </div>
          ) : null}

          <p className="mt-3 text-[11px] leading-[17px] text-[var(--color-ink-2)]">
            {update.message ??
              'The loader checks for a new version a few seconds after it opens, and every few hours after that.'}
          </p>

          {update.detail ? (
            <p className="mt-1.5 font-mono text-[10px] leading-[15px] text-[var(--color-ink-3)]">
              {update.detail}
            </p>
          ) : null}
        </section>

        <section
          className="flex items-center justify-between border border-[var(--hairline)] bg-[var(--color-surface)] px-4 py-3"
          style={{ borderRadius: 14 }}
        >
          <div>
            <div className="text-[12px] font-semibold text-[var(--color-ink)]">About</div>
            <div className="mt-1 text-[11px] text-[var(--color-ink-2)]">
              INDRA LOADER — running {version?.running ?? '—'}
              {version && version.installed !== version.running
                ? `, installed ${version.installed}`
                : ''}
            </div>
          </div>
          <span className="rounded border border-[var(--hairline)] px-1.5 py-[2px] text-[10px] text-[var(--color-ink-3)]">
            {version?.packaged ? 'installed build' : 'development build'}
          </span>
        </section>

        <section
          className="border border-[var(--hairline)] bg-[var(--color-surface)] px-4 py-3"
          style={{ borderRadius: 14 }}
        >
          <div className="text-[12px] font-semibold text-[var(--color-ink)]">Links</div>
          {links.length === 0 ? (
            <div className="mt-1 text-[11px] text-[var(--color-ink-3)]">No links published yet.</div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {links.map((link) => (
                <button
                  key={link.label}
                  type="button"
                  onClick={() => onOpen(link.url)}
                  className="h-7 rounded-md border border-[var(--hairline)] bg-[var(--color-raised)] px-2.5 text-[11px] text-[var(--color-ink-2)] transition-colors duration-150 hover:border-[var(--hairline-strong)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                >
                  {link.label}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
