import { useState } from 'react'

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

/*
 * The washes are always mounted, under the film.
 *
 * A video that fails — wrong codec, 404, a bucket that stopped answering, a
 * customer on a connection that gives up — must not leave a black rectangle where
 * the sign-in screen should be. The fallback is already behind it, so the worst
 * case is the screen we had before the film existed.
 */
export default function Backdrop({ video, poster }: Props): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const showVideo = Boolean(video) && !failed

  return (
    <div className="backdrop" data-video={showVideo ? 'true' : 'false'} aria-hidden>
      <span className="wash-a" />
      <span className="wash-b" />
      <span className="wash-c" />

      {showVideo ? (
        <video
          className="backdrop-video"
          src={video}
          poster={poster}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          // Decorative: never take focus, never offer controls.
          tabIndex={-1}
          disablePictureInPicture
          onError={() => setFailed(true)}
        />
      ) : null}
    </div>
  )
}
