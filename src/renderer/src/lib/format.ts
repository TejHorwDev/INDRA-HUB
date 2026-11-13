export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatRelative(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'

  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'Updated today'
  if (days === 1) return 'Updated yesterday'
  if (days < 14) return `Updated ${days} days ago`
  return `Updated ${formatDate(iso)}`
}

export function formatClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

/**
 * A stable hue for a person or a group. Same id, same colour, everywhere — so
 * the monogram in the sidebar is the monogram on the roster and in a search
 * result, and nobody has to learn a second face for the same colleague.
 *
 * FNV-1a keeps neighbouring ids far apart in hue; the red end of the wheel is
 * skipped so that no monogram can be mistaken for a destructive state.
 */
export function toneOf(id: string): number {
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  const hue = hash % 360
  return hue < 22 || hue > 344 ? (hue + 42) % 360 : hue
}
