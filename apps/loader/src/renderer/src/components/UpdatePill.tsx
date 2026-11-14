import type { UpdateState } from '@shared/types'

/*
 * "An update is ready" — everywhere, once, quietly.
 *
 * The updater restarts by itself if it can do so safely (before anything has been
 * started). This is the other case: an update that arrives while somebody is using
 * the app, where restarting on its own would interrupt them. So it is offered, not
 * taken.
 *
 * It sits at the bottom centre, out of the way of the library, the detail panel and
 * the settings list, and it is the only element in the app that is allowed to
 * appear without being asked for.
 */

interface Props {
  update: UpdateState | null
  onInstall: () => void
}

export default function UpdatePill({ update, onInstall }: Props): React.JSX.Element | null {
  if (!update || update.phase !== 'ready') return null

  return (
    <div
      className="fade-up absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--hairline-strong)] bg-[#101014]/92 pl-3 pr-1 py-1"
      style={{ bottom: 12, boxShadow: 'var(--lift)', backdropFilter: 'blur(8px)' }}
    >
      <span className="text-[10px] text-[var(--color-ink-2)]">
        {update.version ? `Version ${update.version} is ready` : 'An update is ready'}
      </span>
      <button
        onClick={onInstall}
        className="rounded-full px-2.5 py-1 text-[10px] font-semibold text-[var(--color-accent)] transition-colors duration-150 hover:bg-white/6 hover:text-[var(--color-ink)]"
      >
        Restart
      </button>
    </div>
  )
}
