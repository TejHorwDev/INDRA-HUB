/*
 * Version comparison, the same rules the desktop app uses.
 *
 * Numeric per segment, missing segments are zero, and a pre-release suffix sorts
 * below the release it precedes. Kept identical on both sides on purpose: if the
 * panel and the app disagree about which of two versions is newer, one of them is
 * offering a downgrade and calling it an update.
 */

export function compareVersions(a: string, b: string): number {
  const parts = (value: string): number[] =>
    value
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      .split('.')
      .map((piece) => Number(piece) || 0)

  const left = parts(a)
  const right = parts(b)
  const length = Math.max(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const one = left[index] ?? 0
    const other = right[index] ?? 0
    if (one !== other) return one > other ? 1 : -1
  }

  const pre = (value: string): boolean => /[-+]/.test(value)
  if (pre(a) && !pre(b)) return -1
  if (!pre(a) && pre(b)) return 1
  return 0
}
