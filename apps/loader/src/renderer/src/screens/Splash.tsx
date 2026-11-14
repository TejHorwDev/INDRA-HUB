/*
 * Splash.
 *
 * "INDRA CHEATS LOADER" at 24px, each glyph arriving 22ms after the one before it,
 * then a hairline that sweeps out from the first letter.
 *
 * Two seconds, not four. Four was long enough to feel like something was loading,
 * and nothing is: the app is already running, and the splash is the window
 * arriving rather than a wait.
 */

const TITLE = 'INDRA CHEATS LOADER'

export default function Splash(): React.JSX.Element {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center">
      <div className="text-[24px] leading-none tracking-[0.02em]">
        {TITLE.split('').map((glyph, index) => (
          <span
            key={`${glyph}-${index}`}
            className="glyph wordmark"
            style={{ animationDelay: `${index * 22}ms` }}
          >
            {glyph === ' ' ? '\u00A0' : glyph}
          </span>
        ))}
      </div>

      <div
        className="rule mt-4 w-[196px]"
        style={{ animationDelay: `${TITLE.length * 22 + 40}ms` }}
      />
    </div>
  )
}
