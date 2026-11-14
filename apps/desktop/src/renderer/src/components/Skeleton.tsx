import type { CSSProperties } from 'react'

interface SkeletonProps {
  width?: number | string
  height?: number | string
  radius?: number | string
  className?: string
}

/** Base shimmer block. Compose these into screen-specific skeletons. */
export function Skeleton({ width = '100%', height = 12, radius = 6, className }: SkeletonProps) {
  const style: CSSProperties = { width, height, borderRadius: radius }
  return <span className={`skeleton${className ? ` ${className}` : ''}`} style={style} aria-hidden="true" />
}

/** A few stacked lines for paragraph-shaped placeholders. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={`flex flex-col gap-2${className ? ` ${className}` : ''}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} height={10} width={index === lines - 1 ? '60%' : '100%'} />
      ))}
    </span>
  )
}
