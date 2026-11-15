/*
 * The curtain.
 *
 * After a sign-in the library used to open on nothing: the grid painted with the catalogue
 * it had, then artwork arrived behind the names, then each video card spent its first
 * second buffering. Two seconds of watching a screen assemble itself, every time.
 *
 * So the library is mounted *under this*, in full, and given four and a half seconds: the
 * catalogue lands, every image decodes, every clip is fetched into the cache and starts
 * playing. Then this fades and the grid is simply already there — cards painted, videos at
 * speed, nothing popping in.
 *
 * A spinner and nothing else, same as the verifying screen. Text here would be an apology
 * for a wait; there is nothing to apologise for, because nothing on this screen is doing
 * anything you have to think about.
 */

import Spinner from '../components/Spinner'

export default function Preparing({
  out,
  holdMs = 4_500
}: {
  out: boolean
  /** How long the curtain will be up. The hairline is drawn to the same clock. */
  holdMs?: number
}): React.JSX.Element {
  return (
    <div className="curtain" data-out={out}>
      <div className="curtain-body">
        <Spinner label="Loading your library" />
        {/*
          * A hairline that fills over the same four and a half seconds the curtain is
          * held for. A circle alone cannot tell you whether it is working or stuck; a
          * line that is visibly longer than it was a second ago can.
          */}
        <span className="curtain-rule" aria-hidden>
          <i style={{ animationDuration: `${holdMs}ms` }} />
        </span>
      </div>
    </div>
  )
}
