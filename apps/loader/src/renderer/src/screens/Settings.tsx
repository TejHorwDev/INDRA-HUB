import { useEffect, useState } from 'react'
import type { LoaderConfig, UpdateDiagnostics, UpdateState } from '@shared/types'
import WindowControls from '../components/WindowControls'
import { bridge } from '../lib/bridge'

/*
 * Settings.
 *
 * Rebuilt around a rail and a page, because this screen is going to grow. It used to
 * be a column of cards — each one a bordered box with its own header, its own padding
 * and its own idea of where a button goes — and every new setting would have been one
 * more box in the pile. Worse, the boxes could not agree on a width: "Check access"
 * wrapped onto two lines inside a card that was three hundred pixels too wide for it.
 *
 * So: sections on the left, one section at a time on the right, and inside a section
 * only rows — a label, a value or a control, a hairline. A new setting is one more
 * row. It cannot be misaligned, because there is nothing to align it to.
 *
 * The Access checker is gone. It answered a question nobody asks while looking at
 * settings ("what did the auth service return?"), and it made the screen look like a
 * developer tool. If entitlement is ever wrong, that belongs in the library, next to
 * the card it is wrong about.
 *
 * Everything shown is real data from the updater — no invented "last checked", and no
 * success message when the check failed.
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
  /** Forgets the remembered session and returns to the sign-in form. */
  onSignOut: () => void
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

type Section = 'account' | 'updates' | 'about' | 'links'

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'updates', label: 'Updates' },
  { id: 'account', label: 'Account' },
  { id: 'about', label: 'About' },
  { id: 'links', label: 'Links' }
]

/* The rail. Everything here is share of one page, so the numbers live together. */
const RAIL = { left: 28, width: 164, top: 84 }
const PANE = { left: 248, width: 620, top: 84, maxHeight: 414 }

export default function Settings({
  update,
  version,
  config,
  busy,
  onBack,
  onCheck,
  onInstall,
  onOpen,
  onSignOut
}: Props): React.JSX.Element {
  const [section, setSection] = useState<Section>('updates')

  // One link, and only if it is published. The social channels are not coming back.
  const links = config.website ? [{ label: 'Website', url: config.website }] : []

  /*
   * The update path, tested for real.
   *
   * "It does not update" is three different failures wearing one sentence: the feed
   * could not be reached, the manifest could not be read, or the payload could not be
   * downloaded. Each is a request, and this runs all three in order and prints what
   * came back — so the answer is a sentence rather than another guess.
   */
  const [diagnosis, setDiagnosis] = useState<UpdateDiagnostics | null>(null)
  const [testing, setTesting] = useState(false)
  const [log, setLog] = useState<string[]>([])

  useEffect(() => {
    void bridge.updates.log().then(setLog)
  }, [update.phase])

  async function test(): Promise<void> {
    setTesting(true)
    try {
      setDiagnosis(await bridge.updates.diagnose())
    } finally {
      setTesting(false)
      setLog(await bridge.updates.log())
    }
  }

  const downloading = update.phase === 'downloading' || update.phase === 'available'

  return (
    <div className="absolute inset-0">
      <button
        type="button"
        aria-label="Back"
        onClick={onBack}
        className="no-drag absolute z-50 grid h-10 w-10 place-items-center rounded-full border border-[var(--hairline)] bg-[var(--color-raised)]/80 text-[var(--color-ink-2)] transition-colors duration-150 hover:border-[var(--hairline-strong)] hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        style={{ left: 20, top: 14 }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M7.5 2.5 4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <WindowControls />

      {/* The rail: the title, then the sections. */}
      <div className="absolute" style={{ left: RAIL.left, top: RAIL.top, width: RAIL.width }}>
        <h2
          className="fade-up text-[20px] font-semibold leading-none text-white"
          style={{ letterSpacing: '-0.01em' }}
        >
          Settings
        </h2>

        <nav className="fade-up mt-7 flex flex-col gap-[2px]" aria-label="Settings sections">
          {SECTIONS.map((entry) => {
            const active = entry.id === section
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSection(entry.id)}
                aria-current={active ? 'page' : undefined}
                className={
                  'relative flex h-8 items-center rounded-md pl-3 pr-2 text-left text-[12.5px] transition-colors duration-150 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] ' +
                  (active
                    ? 'text-[var(--color-ink)]'
                    : 'text-[var(--color-ink-3)] hover:text-[var(--color-ink-2)]')
                }
              >
                {/* A bar, not a box: the selected section is marked, not decorated. */}
                <span
                  aria-hidden
                  className={
                    'absolute left-0 top-1/2 h-[14px] w-[2px] -translate-y-1/2 rounded-full transition-opacity duration-150 ' +
                    (active ? 'bg-white opacity-100' : 'opacity-0')
                  }
                />
                {entry.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* The rule between the sections and the page they open. */}
      <div
        aria-hidden
        className="absolute w-px bg-[var(--hairline)]"
        style={{ left: RAIL.left + RAIL.width + 24, top: RAIL.top, bottom: 52 }}
      />

      <div
        className="settings-scroll absolute"
        style={{ left: PANE.left, top: PANE.top, width: PANE.width, maxHeight: PANE.maxHeight }}
      >
        {section === 'updates' ? (
          <Page title="Updates">
            <Setting label="Status">
              <span className="flex items-center gap-2">
                <span
                  className={
                    'h-[5px] w-[5px] rounded-full ' +
                    (update.phase === 'error'
                      ? 'bg-[var(--color-danger)]'
                      : update.phase === 'ready'
                        ? 'bg-[var(--color-success)]'
                        : 'bg-[var(--color-accent)]')
                  }
                />
                {PHASE_TITLE[update.phase]}
                <span className="ml-1 font-mono text-[11px] text-[var(--color-ink-3)]">
                  {version?.running ?? '—'}
                </span>
              </span>
            </Setting>

            {/* What it is doing, in a sentence, where a card used to say it in a
                paragraph of its own. */}
            <div className="border-b border-[var(--hairline)] py-3">
              <p className="max-w-[520px] text-[11.5px] leading-[18px] text-[var(--color-ink-2)]">
                {update.message ??
                  'The loader checks for a new version a few seconds after it opens, and every few hours after that.'}
              </p>
              {update.detail ? (
                <p className="mt-1 break-words font-mono text-[10px] leading-[15px] text-[var(--color-ink-3)]">
                  {update.detail}
                </p>
              ) : null}
              {downloading ? (
                <div className="mt-3 h-[3px] w-full max-w-[520px] overflow-hidden rounded-full bg-white/6">
                  <div
                    className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-200"
                    style={{ width: `${Math.max(4, update.percent)}%` }}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hairline)] py-3">
              <Action disabled={busy || !update.canCheck} onClick={onCheck}>
                Check for updates
              </Action>
              <Action
                disabled={testing || !update.canCheck}
                onClick={() => void test()}
              >
                {testing ? 'Testing…' : 'Test the connection'}
              </Action>
              {update.canInstall ? (
                <Action solid disabled={busy} onClick={onInstall}>
                  Restart to apply
                </Action>
              ) : null}
            </div>

            {diagnosis ? (
              <div className="border-b border-[var(--hairline)] py-3">
                {diagnosis.steps.map((step) => (
                  <p
                    key={step.label}
                    className="flex gap-2 font-mono text-[10px] leading-[16px] text-[var(--color-ink-3)]"
                  >
                    <span className={step.ok ? 'text-[var(--color-ink)]' : 'text-[var(--color-danger)]'}>
                      {step.ok ? 'ok' : 'no'}
                    </span>
                    <span className="min-w-0 flex-1 break-words">
                      {step.label}: {step.detail}
                    </span>
                  </p>
                ))}
              </div>
            ) : null}

            {log.length > 0 ? (
              <details className="py-3">
                <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-3)] transition-colors hover:text-[var(--color-ink-2)]">
                  What the updater did
                </summary>
                <div className="mt-2 space-y-[3px]">
                  {log.slice(-8).map((line) => (
                    <p
                      key={line}
                      className="break-words font-mono text-[9.5px] leading-[14px] text-[var(--color-ink-3)]"
                    >
                      {line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s/, '')}
                    </p>
                  ))}
                </div>
              </details>
            ) : null}
          </Page>
        ) : null}

        {section === 'account' ? (
          <Page title="Account">
            {/*
              No username on screen. The account row exists to get *out*, and printing
              somebody's handle in a window that already hides it everywhere else would
              be inconsistent with the rest of the app.
            */}
            <div className="flex items-center justify-between gap-6 border-b border-[var(--hairline)] py-3">
              <div className="min-w-0">
                <div className="text-[11.5px] text-[var(--color-ink-3)]">Session</div>
                <div className="mt-1 text-[11px] leading-[17px] text-[var(--color-ink-3)]">
                  Signing out ends this session and returns to the sign-in form.
                </div>
              </div>
              <Action onClick={onSignOut}>Sign out</Action>
            </div>
          </Page>
        ) : null}

        {section === 'about' ? (
          <Page title="About">
            <Setting label="Running">{version?.running ?? '—'}</Setting>
            {version && version.installed !== version.running ? (
              <Setting label="Installed">{version.installed}</Setting>
            ) : null}
            <Setting label="Build">
              {version?.packaged ? 'Installed copy' : 'Development copy'}
            </Setting>
            <Setting label="Application">INDRA LOADER</Setting>
          </Page>
        ) : null}

        {section === 'links' ? (
          <Page title="Links">
            {links.length === 0 ? (
              <div className="border-b border-[var(--hairline)] py-3 text-[11.5px] text-[var(--color-ink-3)]">
                Nothing published yet.
              </div>
            ) : (
              links.map((link) => (
                <button
                  key={link.label}
                  type="button"
                  onClick={() => onOpen(link.url)}
                  className="group flex w-full items-center justify-between gap-6 border-b border-[var(--hairline)] py-3 text-left transition-colors duration-150 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
                >
                  <span className="text-[11.5px] text-[var(--color-ink-3)] transition-colors group-hover:text-[var(--color-ink-2)]">
                    {link.label}
                  </span>
                  <span className="flex items-center gap-1.5 text-[12px] text-[var(--color-ink-2)] transition-colors group-hover:text-white">
                    {link.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden>
                      <path d="M2.5 6.5 6.5 2.5M3.4 2.5h3.1v3.1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
              ))
            )}
          </Page>
        ) : null}
      </div>
    </div>
  )
}

/**
 * A page: its name, then rows.
 *
 * The name is small and upper-case on purpose — the rail already says which section
 * this is, so the heading names the page without competing with the values in it.
 */
function Page({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="fade-up">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
        {title}
      </div>
      <div className="border-t border-[var(--hairline)]">{children}</div>
    </div>
  )
}

/** One setting: what it is on the left, what it is on the right. */
function Setting({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-[var(--hairline)] py-3">
      <span className="text-[11.5px] text-[var(--color-ink-3)]">{label}</span>
      <span className="text-right text-[12px] text-[var(--color-ink)]">{children}</span>
    </div>
  )
}

/**
 * A button that does not wrap.
 *
 * The old "Check access" button broke onto two lines inside a card that had room for
 * it, because nothing in the stylesheet said a label is one line. This one says so.
 */
function Action({
  children,
  onClick,
  disabled,
  solid
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  solid?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'h-[30px] shrink-0 whitespace-nowrap rounded-lg px-3 text-[11.5px] font-medium transition-[background,border-color,color] duration-150 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-default ' +
        (solid
          ? 'bg-[#f2f2f4] text-[#0a0a0c] hover:bg-white disabled:bg-white/[0.06] disabled:text-[var(--color-ink-3)]'
          : 'border border-[var(--hairline-strong)] bg-transparent text-[var(--color-ink-2)] hover:border-white/25 hover:text-[var(--color-ink)] disabled:border-[var(--hairline)] disabled:text-[var(--color-ink-3)]')
      }
    >
      {children}
    </button>
  )
}
