/*
 * Turning a sentence somebody typed into something worth reading.
 *
 * A description field is one line, and people fill one line the way they write a
 * message: a claim, then a run of features separated by whatever was on the keyboard —
 * `-`, `|`, `•`, a newline, a colon and a dash. Printed raw, that is a wall of capitals
 * that wraps in the wrong places and reads as shouting:
 *
 *   BEST EXTERNAL CHEATS IN THE MARKET…! MANY COOL FEATURES :-AIMBOT ( EXTERNAL , AI ,
 *   RAGE )-ESP MENU-EXTRA FEATURES-SKIN CHANGER
 *
 * Split into what it actually is — one sentence, then four features — it reads. This
 * does the splitting, and quietly undoes the shouting, because uppercase is how a
 * keyboard shouts and not how a product wants to be read.
 *
 * It is deterministic and dependency-free so it can be proven in the simulation, and it
 * exists in both apps on purpose: the panel previews exactly what the loader will draw,
 * and the two are checked against the same fixtures.
 */

export interface Prose {
  /** The sentence before the feature run. Empty when the whole thing is a list. */
  about: string
  features: string[]
}

/** Words this short are usually acronyms, and lowercasing them is wrong. */
const KEEP_VERBATIM = 3

/**
 * Short capitalised words that are not acronyms.
 *
 * `AI` and `ESP` are names. `IN` and `THE` are the word "in" and the word "the" typed by
 * somebody whose caps lock was on, and leaving them shouting in the middle of a sentence
 * is the difference between a product description and a ransom note.
 */
const SMALL_WORDS = new Set([
  'IN', 'THE', 'AND', 'FOR', 'ALL', 'OFF', 'NEW', 'NOT', 'WHO', 'YOU', 'OUR',
  'OUT', 'TOP', 'ANY', 'ARE', 'CAN', 'MAY', 'ITS', 'USE', 'GET', 'ONE', 'TWO',
  'YES', 'NO', 'PER', 'VIA', 'BUT', 'NOW', 'HOW', 'WHY', 'SET', 'OWN', 'UP'
])

/**
 * Sentence case for text that arrived in capitals.
 *
 * `AIMBOT ( EXTERNAL , AI , RAGE )` → `Aimbot (external, AI, rage)`. Short all-caps words
 * survive because `AI`, `ESP` and `FPS` are names, not shouting; longer ones are lowered
 * because `RAGE` is a word like any other.
 */
function soften(word: string): string {
  const letters = word.replace(/[^A-Za-z]/g, '')
  if (!letters) return word
  if (letters !== letters.toUpperCase()) return word
  // `HWID2`, `FPS60`, `A1`: mixed with digits, leave it alone.
  if (/[0-9]/.test(word)) return word
  if (letters.length <= KEEP_VERBATIM) {
    return SMALL_WORDS.has(letters) ? word.toLowerCase() : word
  }
  return word.toLowerCase()
}

interface Boundary {
  index: number
  length: number
}

/**
 * Where one feature ends and the next begins.
 *
 * A hyphen is the awkward one: `Anti-Aim` is a name and `FEATURES-SKIN` is two features,
 * and both are typed without spaces. The test is whether both sides are shouting — a
 * hyphen between two all-caps words of three letters or more is a boundary, anything else
 * is part of the name.
 */
function boundaries(text: string): Boundary[] {
  const found: Boundary[] = []

  const pattern =
    /\n+|\s*[|•·]\s*|\s*:[-–—]\s*|\s+[-–—]\s*|\s*[-–—]\s+(?=\S)/g

  for (const match of text.matchAll(pattern)) {
    found.push({ index: match.index ?? 0, length: match[0].length })
  }

  /*
   * The tight hyphen, which the pattern above deliberately skips over.
   *
   * `AIMBOT-ESP` is two features and `Anti-Aim` is one name, and both are typed without
   * spaces. What tells them apart is the word on the right: a shouted word of two or more
   * letters starts a feature, a normal one continues a name.
   */
  const tight = /[-–—]([A-Z]{2,})/g
  for (const match of text.matchAll(tight)) {
    if (SMALL_WORDS.has(match[1])) continue
    found.push({ index: match.index ?? 0, length: 1 })
  }

  return found.sort((left, right) => left.index - right.index)
}

function tidy(segment: string): string {
  return segment
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?)\]])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/^[\s,:;.!?…~•·|-]+/, '')
    .replace(/[\s,:;|-]+$/, '')
    .trim()
}

/**
 * Capital first letter, capitals softened throughout, and a new sentence after a full
 * stop — `MARKET…! MANY COOL` became `market…! many cool`, which needs one more letter.
 */
function phrase(segment: string): string {
  const softened = segment
    .split(' ')
    .map((word) => soften(word))
    .join(' ')
    .replace(/([.!?…]+\s+)([a-z])/g, (_whole, stop: string, letter: string) => stop + letter.toUpperCase())

  return softened.charAt(0).toUpperCase() + softened.slice(1)
}

export function parseDescription(raw: string): Prose {
  const text = (raw ?? '').replace(/\r/g, '').trim()
  if (!text) return { about: '', features: [] }

  const cuts = boundaries(text)
  const segments: string[] = []
  let cursor = 0

  for (const cut of cuts) {
    segments.push(text.slice(cursor, cut.index))
    cursor = cut.index + cut.length
  }
  segments.push(text.slice(cursor))

  const cleaned = segments.map(tidy).filter((segment) => segment.length > 0)

  /*
   * One piece of text is one paragraph. Splitting a plain description on the word
   * boundaries it happens to contain would invent a feature list that nobody wrote.
   */
  if (cleaned.length <= 1) {
    return { about: phrase(tidy(text)), features: [] }
  }

  /*
   * The first piece is the claim, unless it reads like a feature — short, and with no
   * full stop. A product whose description is `Aimbot | ESP | Skin changer` has no
   * sentence, and pretending otherwise would print "Aimbot" as one.
   */
  const [first, ...rest] = cleaned
  const looksLikeClaim = first.split(' ').length >= 4 || /[.!?…]$/.test(first)

  const about = looksLikeClaim ? phrase(first) : ''
  const features = (looksLikeClaim ? rest : cleaned)
    .map((segment) => phrase(segment))
    // A "feature" of forty words is a paragraph somebody forgot to separate.
    .filter((segment) => segment.length > 1)

  return { about, features }
}
