/*
 * Splash.
 *
 * "INDRA CHEATS LOADER" at 24px, each glyph arriving 35ms after the one before
 * it, then a hairline that sweeps out from the first letter. Four seconds, no
 * spinner, no progress bar — there is nothing being waited on.
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
            style={{ animationDelay: `${index * 35}ms` }}
          >
            {glyph === ' ' ? '\u00A0' : glyph}
          </span>
        ))}
      </div>

      <div
        className="rule mt-4 w-[196px]"
        style={{ animationDelay: `${TITLE.length * 35 + 60}ms` }}
      />
    </div>
  )
}
