/*
 * The circle.
 *
 * It was a 34px div with a 1.5px border and one edge tinted — which is fine on a phone
 * and wrong here, for two reasons. A quarter of a hairline is almost nothing to look at,
 * so a slow second per turn reads as a still picture; and a border spinner is repainted
 * on the main thread every frame, which on a machine that is decoding three card videos
 * at the same time is exactly the wrong thing to make it do.
 *
 * This is an SVG arc instead: one path, one transform, promoted to the compositor. It
 * turns at exactly one second per revolution regardless of what else the machine is
 * doing, and at any DPI the arc has crisp edges instead of a blurry quarter-border.
 */
export default function Spinner({ label = 'Loading' }: { label?: string }): React.JSX.Element {
  return (
    <svg
      className="spinner"
      viewBox="0 0 40 40"
      width="38"
      height="38"
      role="status"
      aria-label={label}
    >
      <circle cx="20" cy="20" r="17" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1.9" />
      <circle
        cx="20"
        cy="20"
        r="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeDasharray="27 80"
        transform="rotate(-90 20 20)"
      />
    </svg>
  )
}
