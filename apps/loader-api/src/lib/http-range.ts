/*
 * The one `Range` form that matters.
 *
 * Written as a module of its own because it is a parser of untrusted input and because
 * getting it wrong is invisible: a wrong answer sends the whole file where a slice was
 * asked for, and the client that thought it was resuming quietly corrupts its own file.
 */

export interface ByteRange {
  start: number
  /** Inclusive, as HTTP means it. Absent means "to the end". */
  end?: number
}

/**
 * `bytes=0-` / `bytes=100-200` / `bytes=100-`. Returns null for anything else, which
 * means "send the whole thing" — the standard allows a server to ignore a range it does
 * not understand, and multi-range is not worth the complexity for one installer at a
 * time.
 */
export function parseRange(header: string | null): ByteRange | null {
  if (!header) return null
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const start = Number(match[1])
  if (!Number.isFinite(start) || start < 0) return null
  const end = match[2] ? Number(match[2]) : undefined
  if (end !== undefined && (!Number.isFinite(end) || end < start)) return null
  return { start, end }
}
