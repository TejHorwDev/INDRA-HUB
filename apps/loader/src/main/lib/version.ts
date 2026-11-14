/*
 * Version comparison, on its own.
 *
 * Kept separate from `payload.ts` because it is the one piece of the updater
 * that can be proven without Electron: `sim:update` imports this file directly,
 * with no stubbed `app` involved.
 */

/** Numeric compare of `1.2.10` against `1.2.9`. Returns <0, 0 or >0. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] =>
    value
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0))

  const a = parse(left)
  const b = parse(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
