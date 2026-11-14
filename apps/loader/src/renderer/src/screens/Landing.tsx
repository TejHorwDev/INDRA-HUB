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
 * The social row is not decoration — it is the only place a user can find the
 * channels, so each one is a real link that opens in the browser.
 */

const WEBSITE = 'https://indra-cheats.com'

const SOCIALS = [
  { label: 'Instagram', url: 'https://instagram.com/indra', path: 'instagram' },
  { label: 'TikTok', url: 'https://tiktok.com/@indra', path: 'tiktok' },
  { label: 'Discord', url: 'https://discord.gg/indra', path: 'discord' },
  { label: 'YouTube', url: 'https://youtube.com/@indra', path: 'youtube' }
] as const

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

      <div
        className="fade-up absolute left-0 right-0 text-center text-[9.5px] font-semibold uppercase tracking-[0.2em] text-[var(--color-ink-3)]"
        style={{ top: 490, animationDelay: '140ms' }}
      >
        Follow us
      </div>

      <div
        className="fade-up absolute flex items-center gap-4"
        style={{ top: 522, left: 370, animationDelay: '180ms' }}
      >
        {SOCIALS.map((social) => (
          <button
            key={social.label}
            type="button"
            aria-label={social.label}
            onClick={() => onExternal(social.url)}
            className="grid h-7 w-7 place-items-center rounded-full border border-[var(--hairline)] bg-[var(--color-raised)] text-[var(--color-ink-2)] transition-colors duration-150 hover:border-[var(--hairline-strong)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            <SocialMark name={social.path} />
          </button>
        ))}
      </div>
    </div>
  )
}

/** Line marks rather than brand logos: same shapes, one stroke weight, calm. */
function Dot(): React.JSX.Element {
  return <span className="h-[3px] w-[3px] rounded-full bg-[var(--color-ink-3)]/60" />
}

function SocialMark({ name }: { name: string }): React.JSX.Element {
  const common = {
    width: 13,
    height: 13,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.3,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true
  }

  if (name === 'instagram') {
    return (
      <svg {...common}>
        <rect x="2.4" y="2.4" width="11.2" height="11.2" rx="3.4" />
        <circle cx="8" cy="8" r="2.7" />
        <circle cx="11.6" cy="4.5" r="0.6" fill="currentColor" stroke="none" />
      </svg>
    )
  }

  if (name === 'tiktok') {
    return (
      <svg {...common}>
        <path d="M9.4 1.8v8.5a2.9 2.9 0 1 1-2.4-2.85" />
        <path d="M9.4 1.8c.35 1.7 1.55 2.75 3.2 2.9" />
      </svg>
    )
  }

  if (name === 'discord') {
    return (
      <svg {...common}>
        <path d="M5.6 4.2c1.6-.5 3.2-.5 4.8 0l1.5 2.6c.5 1.2.7 2.4.6 3.6-1.1.7-2.3 1.1-3.6 1.2l-.6-.9M5.7 10.7l-.6.9c-1.3-.1-2.5-.5-3.6-1.2-.1-1.2.1-2.4.6-3.6l1.5-2.6" />
        <circle cx="6.1" cy="8" r="0.85" fill="currentColor" stroke="none" />
        <circle cx="9.9" cy="8" r="0.85" fill="currentColor" stroke="none" />
      </svg>
    )
  }

  return (
    <svg {...common}>
      <rect x="1.8" y="3.6" width="12.4" height="8.8" rx="2.6" />
      <path d="M6.8 6.3l3 1.7-3 1.7z" fill="currentColor" stroke="none" />
    </svg>
  )
}
