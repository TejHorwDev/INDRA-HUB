import SlideButton from '../components/SlideButton'
import WindowControls from '../components/WindowControls'

/*
 * The landing page.
 *
 * One line of type and two buttons. It used to carry an eyebrow, a two-line
 * subtitle and three small facts under it, which is four different ways of telling
 * somebody they have installed a launcher. The name is the message; the buttons are
 * the only two things there are to do; everything else was decoration competing with
 * the film behind it.
 *
 * White, not a gradient. A heading that fades toward violet turns the one piece of
 * type on the page into a logo treatment, and the whole app is matte black and white
 * — the name should be the brightest thing here, not the most colourful.
 *
 * No social row. It was four icons and a "follow us" caption, and it read as filler:
 * a landing page for an app you have already installed does not need to send you to
 * Instagram. The website is one button, and it is the only link.
 */

const WEBSITE = 'https://indra-cheats.com'

/** The composition, in the window's own coordinates. */
const TITLE_TOP = 186
const TITLE_SIZE = 50
const BUTTONS_TOP = 300

interface Props {
  onStart: () => void
  /** Leaving the app is confirmed, never a surprise click. */
  onExternal: (url: string) => void
}

export default function Landing({ onStart, onExternal }: Props): React.JSX.Element {
  return (
    <div className="absolute inset-0">
      <WindowControls />

      {/*
       * A white bloom, barely there.
       *
       * Enough light behind the name that it sits on the page instead of floating on
       * top of it. On a matte black field at this opacity it reads as emphasis, not
       * as a colour — which is the whole difference between this and the violet it
       * replaces.
       */}
      <div
        aria-hidden
        className="absolute left-1/2 -translate-x-1/2"
        style={{
          top: TITLE_TOP - 96,
          width: 560,
          height: 250,
          background: 'radial-gradient(closest-side, rgba(255,255,255,0.06), transparent 74%)',
          pointerEvents: 'none'
        }}
      />

      <h1
        className="fade-up absolute left-0 right-0 text-center leading-none"
        style={{
          top: TITLE_TOP,
          fontSize: TITLE_SIZE,
          fontWeight: 600,
          letterSpacing: '0.005em',
          color: '#ffffff'
        }}
      >
        INDRA CHEATS
      </h1>

      <div className="absolute flex items-start gap-[13px]" style={{ top: BUTTONS_TOP, left: 283 }}>
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

      {/* Everything below the buttons is the film, deliberately. */}
    </div>
  )
}
