import sanitizeHtml from 'sanitize-html'

/*
 * The one gate every piece of editor markup passes through.
 *
 * Document blocks are stored as HTML because the editor is a contentEditable,
 * which means whatever the user pastes ends up in a file and is later written
 * back into the DOM with `innerHTML`. The renderer can reach the whole IPC
 * surface through the preload bridge, so a stored `<img onerror=…>` is not a
 * cosmetic problem — it is full control of the app with the user's session.
 *
 * Allowing only the tags the toolbar can actually produce, and only URLs with
 * a safe scheme, closes that. The allowlist is deliberately narrow: if a new
 * formatting feature is added, its tag has to be added here too.
 */

const ALLOWED_TAGS = [
  'p',
  'div',
  'span',
  'br',
  'hr',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'del',
  'ins',
  'mark',
  'small',
  'sub',
  'sup',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'a',
  'img',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'cite',
  'abbr'
]

/** `data:image/svg+xml` can carry script, so inline images are raster only. */
const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'title', 'rel'],
    img: ['src', 'alt', 'title'],
    th: ['colspan', 'rowspan', 'scope'],
    td: ['colspan', 'rowspan'],
    ol: ['start'],
    blockquote: ['cite']
  },
  // No inline styles and no class names: the editor does not produce them, and
  // they are the easiest way to hide something unpleasant.
  allowedStyles: {},
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: false,
  // Drop the tag but keep readable text where that makes sense (`1 < 2`).
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs['href'] ?? ''
      const safe = /^(https?:|mailto:|tel:)/i.test(href)
      const next: Record<string, string> = safe
        ? { href, rel: 'noreferrer noopener' }
        : {}
      if (safe && attribs['title']) next['title'] = attribs['title']
      return { tagName, attribs: next }
    }
  },
  // Anything that survives the parser but still should not be shown.
  exclusiveFilter: (frame) => {
    if (frame.tag === 'img') {
      const src = frame.attribs['src'] ?? ''
      if (src.startsWith('data:')) return !SAFE_DATA_IMAGE.test(src)
      return !/^https?:\/\//i.test(src)
    }
    // Empty anchors and empty spans are just paste residue.
    return (frame.tag === 'span' || frame.tag === 'a') && !frame.text.trim() && !frame.mediaChildren.length
  }
}

/** Cleans one block of editor HTML. Safe to call on already-clean input. */
export function cleanHtml(raw: string, maxLength: number): string {
  return sanitizeHtml(raw, OPTIONS).slice(0, maxLength)
}

/**
 * Image blocks keep their URL in `src` rather than in markup, so it needs the
 * same scheme check. Returns null when the URL cannot be rendered safely.
 */
export function cleanImageSrc(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  if (SAFE_DATA_IMAGE.test(value)) return value
  return null
}
