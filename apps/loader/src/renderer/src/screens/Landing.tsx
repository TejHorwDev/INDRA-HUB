import SlideButton from '../components/SlideButton'
import WindowControls from '../components/WindowControls'


/*
 * The landing page.
 *
 * A centred composition in the 900x550 frame, laid out at the coordinates the
 * design specifies rather than with flow layout: the slider and the website pill
 * form one row 283→617, which is what centres the whole page. Everything below
 * is a single column of the same width.
 *
 * No social row. It was four icons and a "follow us" caption, and it read as
 * filler: a landing page for an app you have already installed does not need to
 * send you to Instagram. The website is one button, and it is the only link.
 */

const WEBSITE = 'https://indra-cheats.com'

interface Props {
  onStart: () => void
  /** Leaving the app is confirmed, never a surprise click. */
  onExternal: (url: string) => void
}

export default function Landing({ onStart, onExternal }: Props): React.JSX.Element {
  return (
    <div className="absolute inset-0">
      <WindowControls />

      {/* A soft bloom behind the title, so the type sits on light rather than
          floating on a flat field. */}
      <div
        aria-hidden
        className="absolute left-1/2 -translate-x-1/2"
        style={{
          top: 54,
          width: 520,
          height: 210,
          background: 'radial-gradient(closest-side, rgba(167,155,199,0.14), transparent 72%)',
          pointerEvents: 'none'
        }}
      />

      <div
        className="fade-up absolute left-0 right-0 text-center text-[9.5px] font-semibold uppercase tracking-[0.34em] text-[var(--color-ink-3)]"
        style={{ top: 92 }}
      >
        Indra
      </div>

      <h1
        className="wordmark fade-up absolute left-0 right-0 text-center text-[32.5px] leading-none"
        style={{ top: 116 }}
      >
        INDRA CHEATS
      </h1>

      <p
        className="fade-up absolute left-0 right-0 text-center text-[12.5px] leading-[20px] text-[var(--color-ink-2)]"
        style={{ top: 164, animationDelay: '60ms' }}
      >
        Premium game enhancement, delivered.
        <br />
        Sign in to open your library.
      </p>

      {/* The space between the subtitle and the slider is what made the page feel
          unfinished. Three short facts belong there. */}
      <div
        className="fade-up absolute left-0 right-0 flex items-center justify-center gap-3 text-[10px] tracking-[0.02em] text-[var(--color-ink-3)]"
        style={{ top: 250, animationDelay: '100ms' }}
      >
        <span>Signed downloads</span>
        <Dot />
        <span>Updates in place</span>
        <Dot />
        <span>No reinstallers</span>
      </div>

      <div className="absolute flex items-start gap-[13px]" style={{ top: 315, left: 283 }}>
        <SlideButton label="Get Started" width={174} height={40} onConfirm={onStart} />

        <button
          type="button"
          onClick={() => onExternal(WEBSITE)}
          className="grid h-10 place-items-center border border-[var(--hairline)] bg-[var(--color-raised)] text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-2)] transition-colors duration-150 hover:border-[var(--hairline-strong)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          style={{ width: 147, borderRadius: 10 }}
        >
          Website
        </button>
      </div>

      {/* The bottom third is empty on purpose. It used to hold a social row; the
          page is calmer without one, and the slider is the only thing to do. */}
    </div>
  )
}

/** Line marks rather than brand logos: same shapes, one stroke weight, calm. */
function Dot(): React.JSX.Element {
  return <span className="h-[3px] w-[3px] rounded-full bg-[var(--color-ink-3)]/60" />
}
