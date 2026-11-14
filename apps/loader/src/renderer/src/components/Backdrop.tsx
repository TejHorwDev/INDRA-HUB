import { memo, useCallback, useEffect, useRef, useState } from 'react'

/*
 * The film behind the window.
 *
 * Three drifting washes, or a real video when one is supplied. The video slot exists
 * because a product film is the obvious thing to want here, and it takes a `file://` or
 * bundled URL without any other change — the CSS layer stays as the fallback, so the
 * screen is never empty while a video loads or if it fails.
 *
 * Two things make it smooth, and both were earned:
 *
 *  1. **Two layers, not `loop`.** The `loop` attribute seeks back to zero and pays for
 *     it — on a large file that is a visible freeze at every join, which reads as "the
 *     video pauses sometimes". A standby element is loaded underneath instead, and takes
 *     over just before the playing one ends, cross-faded. The join is a fade, not a
 *     seek.
 *  2. **It does not re-render.** This sits under every screen and would otherwise be
 *     rebuilt by every download progress tick; `memo` means a transfer in progress
 *     cannot make the film stutter by asking React to touch it four times a second.
 *
 * Both are `pointer-events: none` and sit under everything: this is scenery, not a
 * control surface.
 */

interface Props {
  /** A bundled or absolute URL. Omit for the animated wash. */
  video?: string
  poster?: string
}

/** How long before the end the standby layer takes over. Short: two decoders, briefly. */
const HANDOVER_SECONDS = 0.45

/*
 * The washes are always mounted, under the film.
 *
 * A video that fails — wrong codec, 404, a bucket that stopped answering, a customer on
 * a connection that gives up — must not leave a black rectangle where the sign-in screen
 * should be. The fallback is already behind it, so the worst case is the screen we had
 * before the film existed.
 */
function Backdrop({ video, poster }: Props): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const [front, setFront] = useState(0)
  const first = useRef<HTMLVideoElement>(null)
  const second = useRef<HTMLVideoElement>(null)
  const switching = useRef(false)

  const showVideo = Boolean(video) && !failed

  // A new film starts on the first layer, from the beginning.
  useEffect(() => {
    setFront(0)
    setFailed(false)
    switching.current = false
  }, [video])

  const handOver = useCallback(
    (index: number) => {
      if (switching.current || index !== front) return
      const current = (index === 0 ? first : second).current
      const next = (index === 0 ? second : first).current
      if (!current || !next) return

      const { duration, currentTime } = current
      if (!Number.isFinite(duration) || duration <= 0) return
      if (duration - currentTime > HANDOVER_SECONDS) return

      switching.current = true
      try {
        next.currentTime = 0
      } catch {
        /* not seekable yet; it plays from wherever it is */
      }
      void next.play().catch(() => setFailed(true))
      setFront(index === 0 ? 1 : 0)
      // Released after the fade, so the next join can happen.
      window.setTimeout(() => {
        switching.current = false
      }, 900)
    },
    [front]
  )

  return (
    <div className="backdrop" data-video={showVideo ? 'true' : 'false'} aria-hidden>
      <span className="wash-a" />
      <span className="wash-b" />
      <span className="wash-c" />

      {showVideo ? (
        <>
          <video
            ref={first}
            className="backdrop-video"
            data-front={front === 0 ? 'true' : 'false'}
            src={video}
            poster={poster}
            autoPlay
            muted
            playsInline
            preload="auto"
            // Decorative: never take focus, never offer controls.
            tabIndex={-1}
            disablePictureInPicture
            onTimeUpdate={() => handOver(0)}
            onError={() => setFailed(true)}
          />
          {/*
            The standby layer: loaded, paused on its first frame. It costs a fade
            instead of a fetch, and it is only decoded while it is on screen — which
            matters for a 4K film on a laptop.
          */}
          <video
            ref={second}
            className="backdrop-video"
            data-front={front === 1 ? 'true' : 'false'}
            src={video}
            poster={poster}
            muted
            playsInline
            preload="auto"
            tabIndex={-1}
            disablePictureInPicture
            onTimeUpdate={() => handOver(1)}
            onError={() => setFailed(true)}
          />
        </>
      ) : null}
    </div>
  )
}

export default memo(Backdrop)
