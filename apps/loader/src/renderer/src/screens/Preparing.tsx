/*
 * The loading state. The only one.
 *
 * After a sign-in the library used to open on nothing: the grid painted with whatever the
 * catalogue had, artwork arrived behind the names one card at a time, and each video card
 * spent its first second buffering. Two seconds of watching a screen assemble itself, every
 * launch.
 *
 * So the app takes four and a half seconds under here to do all of that where nobody can
 * see it: the catalogue, the entitlement, every image decoded, every clip pulled into the
 * cache. Then this fades and the grid is simply there.
 *
 * It is also the login. It used to be two screens — this one, and a verifying spinner
 * before it — the same circle twice with a change of scenery in between, which is read as
 * one long stall because that is what it is. The curtain goes up when Sign in is pressed
 * and comes down once, and everything happens underneath it.
 *
 * The library is deliberately *not* mounted underneath while this is up. A grid of cards
 * means a film plus one decoder per video card, and a machine busy decoding is a machine
 * that renders this circle in steps. Warming bytes costs no decoder, so the circle gets
 * the whole machine and turns at exactly one second a revolution. The film itself keeps
 * playing: it is the room you are standing in, and it does not stop because you are
 * waiting.
 *
 * A circle, and nothing else — unless the wait turns out to be broken, in which case it
 * says so once and offers the way out. No bar, no wordmark, nothing that moves except the
 * circle.
 */

import Spinner from '../components/Spinner'

interface Props {
  /** The curtain is fading. */
  out: boolean
  /** The wait has gone on long enough that silence would look like a hang. */
  stalled?: boolean
  /** The only thing worth offering a stalled wait. */
  onBack?: () => void
}

export default function Preparing({ out, stalled = false, onBack }: Props): React.JSX.Element {
  return (
    <div className="curtain" data-out={out}>
      <div className="curtain-stack">
        <Spinner label="Loading your library" />

        {/*
          * Not decoration: a loading state that has been up for twelve seconds and says
          * nothing is indistinguishable from a hung app. This is the app admitting it is
          * slow, and the only useful thing it can offer while it is.
          */}
        {stalled ? (
          <div className="fade-up flex flex-col items-center gap-3">
            <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-ink-3)]">
              Still connecting
            </span>
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="text-[11px] text-[var(--color-ink-2)] underline decoration-white/20 underline-offset-[5px] transition-colors duration-150 hover:text-[var(--color-ink)] hover:decoration-white/40 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
              >
                Back to sign in
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
