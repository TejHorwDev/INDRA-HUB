/*
 * The curtain.
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
 * The library is deliberately *not* mounted underneath while this is up. A grid of cards
 * means a film plus one decoder per video card, and a machine busy decoding is a machine
 * that renders this circle in steps. Warming bytes costs no decoder, so the circle gets
 * the whole machine and turns at exactly one second a revolution.
 *
 * A circle, and nothing else. No bar, no caption, no wordmark.
 */

import Spinner from '../components/Spinner'

export default function Preparing({ out }: { out: boolean }): React.JSX.Element {
  return (
    <div className="curtain" data-out={out}>
      <Spinner label="Loading your library" />
    </div>
  )
}
