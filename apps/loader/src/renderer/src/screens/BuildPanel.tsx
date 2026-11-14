import { useState } from 'react'
import type { UpdateDiagnostics, UpdateState } from '@shared/types'
import Button from '../components/Button'
import { bridge } from '../lib/bridge'

/*
 * Temporary screen for stage 0.
 *
 * Its whole job is to make the update pipeline visible on an installed copy:
 * which version is running, which version the installer shipped, what the
 * updater is doing, and a real end-to-end probe. Replaced by the landing page.
 */

interface Props {
  update: UpdateState
  version: { running: string; installed: string; packaged: boolean } | null
  username: string | null
}

const PHASE_LABEL: Record<UpdateState['phase'], string> = {
  unsupported: 'Not available here',
  idle: 'Not checked yet',
  checking: 'Checking',
  'up-to-date': 'Up to date',
  available: 'Update found',
  downloading: 'Downloading',
  ready: 'Ready to apply',
  error: 'Check failed'
}

export default function BuildPanel({ update, version, username }: Props): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [diagnostics, setDiagnostics] = useState<UpdateDiagnostics | null>(null)


  async function run<T>(work: () => Promise<T>): Promise<void> {
    setBusy(true)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* The window is frameless, so this strip is what a user grabs to move it. */}
      <header className="drag flex h-11 shrink-0 items-center justify-between border-b border-[var(--hairline)] px-5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
          Build
        </span>
        <div className="no-drag flex items-center gap-1">
          <button
            type="button"
            aria-label="Minimise"
            onClick={() => bridge?.window.minimize()}
            className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-ink-3)] transition-colors duration-150 hover:bg-white/5 hover:text-[var(--color-ink)]"
          >
            <span className="block h-px w-3 bg-current" />
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={() => bridge?.window.close()}
            className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-ink-3)] transition-colors duration-150 hover:bg-[var(--color-danger)]/15 hover:text-[var(--color-danger)]"
          >
            <span className="relative block h-3 w-3">
              <span className="absolute left-1/2 top-1/2 block h-px w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-current" />
              <span className="absolute left-1/2 top-1/2 block h-px w-3 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-current" />
            </span>
          </button>
        </div>
      </header>

      <div className="fade-up flex flex-1 flex-col gap-5 p-8">
        <div>
          <h1 className="wordmark text-[24px] leading-none">INDRA CHEATS LOADER</h1>
          <p className="mt-2 text-[12px] text-[var(--color-ink-2)]">
            {username ? `Signed in as ${username}. ` : ''}
            Stage 2 — the flow works; the catalogue is next.
          </p>
        </div>

        <section className="panel grid grid-cols-3 gap-px overflow-hidden bg-[var(--hairline)]">
          <Cell label="Running" value={version?.running ?? '—'} />
          <Cell label="Installer shipped" value={version?.installed ?? '—'} />
          <Cell label="Build" value={version?.packaged ? 'installed' : 'development'} />
        </section>

        <section className="panel flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
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
              <span className="text-[12px] font-medium">{PHASE_LABEL[update.phase]}</span>
              {update.version ? (
                <span className="rounded border border-[var(--hairline)] px-1.5 py-0.5 text-[10.5px] text-[var(--color-ink-2)]">
                  {update.version}
                </span>
              ) : null}
            </div>

            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={busy || !update.canCheck}
                onClick={() => void run(async () => setDiagnostics(await bridge.updates.diagnose()))}
              >
                Diagnose
              </Button>
              <Button
                variant="ghost"
                disabled={busy || !update.canCheck}
                onClick={() => void run(() => bridge.updates.check())}
              >
                Check
              </Button>
              {update.canInstall ? (
                <Button
                  variant="solid"
                  disabled={busy}
                  onClick={() => void run(() => bridge.updates.install())}
                >
                  Restart to apply
                </Button>
              ) : null}
            </div>
          </div>

          {update.phase === 'downloading' ? (
            <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/6">
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-200"
                style={{ width: `${update.percent}%` }}
              />
            </div>
          ) : null}

          <p className="text-[11.5px] leading-relaxed text-[var(--color-ink-2)]">
            {update.message ?? 'The updater has not run yet.'}
          </p>
          {update.detail ? (
            <p className="font-mono text-[10px] leading-relaxed text-[var(--color-ink-3)]">
              {update.detail}
            </p>
          ) : null}
        </section>

        {diagnostics ? (
          <section className="panel fade-up flex flex-col gap-2 p-4">
            {diagnostics.steps.map((step) => (
              <div key={step.label} className="flex items-baseline justify-between gap-4">
                <span className="text-[11.5px] text-[var(--color-ink-2)]">{step.label}</span>
                <span
                  className={
                    'text-right font-mono text-[10px] ' +
                    (step.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]')
                  }
                >
                  {step.detail}
                </span>
              </div>
            ))}
            <p className="mt-1 text-[11.5px] text-[var(--color-ink)]">{diagnostics.summary}</p>
          </section>
        ) : null}
      </div>
    </div>
  )
}

function Cell({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="bg-[var(--color-surface)] px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
        {label}
      </div>
      <div className="mt-1 font-mono text-[13px] text-[var(--color-ink)]">{value}</div>
    </div>
  )
}
