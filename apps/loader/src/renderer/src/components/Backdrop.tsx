/*
 * The sign-in backdrop.
 *
 * Three drifting washes, or a real video when one is supplied. The video slot
 * exists because a product film is the obvious next thing to want here, and it
 * takes a `file://` or bundled URL without any other change — the CSS layer stays
 * as the fallback, so the screen is never empty while a video loads or if it
 * fails.
 *
 * Both are `pointer-events: none` and sit under everything: this is scenery, not
 * a control surface.
 */

interface Props {
  /** A bundled or absolute URL. Omit for the animated wash. */
  video?: string
  poster?: string
}

export default function Backdrop({ video, poster }: Props): React.JSX.Element {
  return (
    <div className="backdrop" aria-hidden>
      {video ? (
        <video
          className="backdrop-video"
          src={video}
          poster={poster}
          autoPlay
          muted
          loop
          playsInline
          // Decorative: never take focus, never offer controls.
          tabIndex={-1}
          disablePictureInPicture
        />
      ) : (
        <>
          <span className="wash-a" />
          <span className="wash-b" />
          <span className="wash-c" />
        </>
      )}
    </div>
  )
}
