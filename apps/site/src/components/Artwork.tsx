/*
 * Product artwork, as the panel publishes it.
 *
 * The panel accepts a still or a clip, and most of what is published there is a clip —
 * a .webm of the product running in game. An <img> pointed at a .webm is four empty
 * boxes, which is exactly what this file exists to prevent.
 */
export default function Artwork({
  src,
  video,
  blur = 0,
  dim = 0,
  className,
  eager = false
}: {
  src: string
  video: boolean
  blur?: number
  dim?: number
  className?: string
  eager?: boolean
}): React.JSX.Element {
  const style = {
    filter: blur ? `blur(${blur}px)` : undefined,
    transform: blur ? `scale(${1 + Math.min(0.16, blur / 170)})` : undefined
  }

  return (
    <>
      {video ? (
        <video
          className={className}
          src={src}
          autoPlay
          muted
          loop
          playsInline
          preload={eager ? 'auto' : 'metadata'}
          aria-hidden
          style={style}
        />
      ) : (
        <img className={className} src={src} alt="" loading={eager ? 'eager' : 'lazy'} style={style} />
      )}
      {dim ? (
        <span
          className="artwork-dim"
          aria-hidden
          style={{ background: `rgba(5, 5, 6, ${Math.min(90, dim) / 100})` }}
        />
      ) : null}
    </>
  )
}
