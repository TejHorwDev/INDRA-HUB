import type { ReactNode } from 'react'
import { initialsOf } from '../lib/format'
import { usePortraitUrl } from '../lib/portraits'

/**
 * A person's portrait.
 *
 * There is no image file anywhere in the app. A portrait is one of eight marks
 * drawn in the same monochrome system as every other icon, chosen once when
 * the account is made, and rendered from its id wherever the person appears.
 * That is why the same face can be 26px in a member row, 32px in the rail and
 * 96px on the chooser without a second copy existing, and why a shared project
 * never has to upload or download a picture to show who wrote something.
 *
 * `initials` — and an account that has not chosen — falls back to the person's
 * initials, which is the honest default rather than a random picture.
 */

export interface AvatarMark {
  id: string
  label: string
  /** Drawn on a 24×24 grid with currentColor. */
  draw: ReactNode
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.15,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export const AVATAR_MARKS: AvatarMark[] = [
  {
    id: 'orbit',
    label: 'Orbit',
    draw: (
      <>
        <circle cx="12" cy="12" r="7.4" {...stroke} />
        <path d="M12 2.2v2.4M12 19.4v2.4M2.2 12h2.4M19.4 12h2.4" {...stroke} opacity={0.55} />
        <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      </>
    )
  },
  {
    id: 'axis',
    label: 'Axis',
    draw: (
      <>
        <path d="M4 20V4M4 20h16" {...stroke} />
        <path d="M4 20L20 4" {...stroke} opacity={0.45} />
        <circle cx="14.5" cy="9.5" r="2.4" fill="currentColor" />
      </>
    )
  },
  {
    id: 'quad',
    label: 'Quad',
    draw: (
      <>
        <rect x="3.6" y="3.6" width="7.2" height="7.2" rx="1" {...stroke} />
        <rect x="13.2" y="3.6" width="7.2" height="7.2" rx="1" {...stroke} opacity={0.5} />
        <rect x="3.6" y="13.2" width="7.2" height="7.2" rx="1" {...stroke} opacity={0.5} />
        <rect x="13.2" y="13.2" width="7.2" height="7.2" rx="1" fill="currentColor" opacity={0.9} />
      </>
    )
  },
  {
    id: 'arcs',
    label: 'Arcs',
    draw: (
      <>
        <path d="M4 20a16 16 0 0 1 16-16" {...stroke} />
        <path d="M4 20a11 11 0 0 1 11-11" {...stroke} opacity={0.7} />
        <path d="M4 20a6 6 0 0 1 6-6" {...stroke} opacity={0.42} />
      </>
    )
  },
  {
    id: 'bands',
    label: 'Bands',
    draw: (
      <>
        <path d="M4 6.5h16" {...stroke} opacity={0.4} />
        <path d="M4 12h16" {...stroke} />
        <path d="M4 17.5h16" {...stroke} opacity={0.62} />
        <circle cx="9" cy="12" r="2.1" fill="currentColor" />
      </>
    )
  },
  {
    id: 'prism',
    label: 'Prism',
    draw: (
      <>
        <path d="M12 3.4 21 19.6H3L12 3.4Z" {...stroke} />
        <path d="M12 9.6v6.2M8.6 15.8h6.8" {...stroke} opacity={0.55} />
      </>
    )
  },
  {
    id: 'steps',
    label: 'Steps',
    draw: (
      <>
        <path d="M3.4 19.4h5v-5h5v-5h5v-5" {...stroke} />
        <path d="M18.4 4.4h2.2v2.2" {...stroke} opacity={0.5} />
        <circle cx="5.9" cy="16.9" r="1.5" fill="currentColor" opacity={0.85} />
      </>
    )
  },
  {
    id: 'signal',
    label: 'Signal',
    draw: (
      <>
        <path d="M5 19V13M9.7 19V9.5M14.3 19V6M19 19V11" {...stroke} strokeWidth={1.8} />
        <path d="M3.4 21.6h17.2" {...stroke} opacity={0.4} />
      </>
    )
  }
]

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl'

interface AvatarProps {
  name: string
  /** `mark:<id>` or `initials`; null/undefined shows initials. */
  avatar?: string | null
  size?: AvatarSize
  className?: string
  /** Screen readers get the name only where the avatar stands alone. */
  title?: string
}

export function markFor(avatar?: string | null): AvatarMark | null {
  if (!avatar || !avatar.startsWith('mark:')) return null
  const id = avatar.slice('mark:'.length)
  return AVATAR_MARKS.find((mark) => mark.id === id) ?? null
}

export default function Avatar({ name, avatar, size, className, title }: AvatarProps) {
  const mark = markFor(avatar)
  // Only `photo:` ids fetch anything; a mark or initials renders immediately.
  const photo = usePortraitUrl(avatar)
  const classes = ['avatar', size && `avatar--${size}`, className].filter(Boolean).join(' ')

  return (
    <span
      className={classes}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      title={title}
      role={title ? 'img' : undefined}
      data-mark={photo ? 'photo' : mark?.id}
    >
      {photo ? (
        <img className="avatar-photo" src={photo} alt="" draggable={false} />
      ) : mark ? (
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          {mark.draw}
        </svg>
      ) : (
        initialsOf(name)
      )}
    </span>
  )
}
