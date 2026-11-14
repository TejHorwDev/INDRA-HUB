import { randomUUID } from 'node:crypto'
import type { DocBlock, Slide, SlideLayout, SlideTable } from '@shared/types'

/**
 * Deterministic, offline document → presentation conversion.
 *
 * It reads only the document's saved structure (headings, paragraphs, lists,
 * tables, images) and applies fixed rules. No network access, no AI, no
 * randomness: the same document always produces the same deck.
 */

const TEXT_SLIDE_CHARS = 620
const MAX_PARAGRAPHS = 4
const MAX_BULLETS = 6
const MAX_TABLE_ROWS = 6

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** Plain text from the block's inline HTML. */
export function blockText(html: string | undefined): string {
  if (!html) return ''
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(withBreaks)
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isBlank(block: DocBlock): boolean {
  if (block.type === 'table') return !block.rows || block.rows.length === 0
  if (block.type === 'image') return !block.src
  if (block.type === 'divider') return false
  return blockText(block.html).length === 0
}

const CLOSING = /^(conclusion|conclusions|summary|closing|next steps|wrap[- ]?up)\b/i

/**
 * Splits prose into slide-sized chunks without cutting mid-sentence when the
 * paragraph already fits.
 */
function splitParagraphs(paragraphs: string[]): string[][] {
  const slides: string[][] = []
  let current: string[] = []
  let length = 0

  for (const paragraph of paragraphs) {
    if (current.length > 0 && (length + paragraph.length > TEXT_SLIDE_CHARS || current.length >= MAX_PARAGRAPHS)) {
      slides.push(current)
      current = []
      length = 0
    }
    current.push(paragraph)
    length += paragraph.length
  }

  if (current.length > 0) slides.push(current)
  return slides
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size))
  }
  return out
}

function makeSlide(
  layout: SlideLayout,
  title: string,
  notes: string,
  extra: Partial<Slide> = {}
): Slide {
  return { id: randomUUID(), layout, title, notes, ...extra }
}

export interface ConversionResult {
  slides: Slide[]
  /** Human-readable account of the rules that produced the deck. */
  summary: string
}

export function convertDocumentToSlides(
  documentTitle: string,
  blocks: DocBlock[]
): ConversionResult {
  const content = blocks.filter((block) => !isBlank(block))
  const slides: Slide[] = []

  // Cover: the document title, with the opening paragraph as subtitle.
  const firstParagraph = content.find((block) => block.type === 'paragraph')
  const subtitle = firstParagraph ? blockText(firstParagraph.html).slice(0, 180) : undefined
  slides.push(
    makeSlide('title', documentTitle, 'Generated from the document title.', {
      body: subtitle
    })
  )

  let section = documentTitle
  let pendingHeading: string | null = null
  let paragraphs: string[] = []
  let sawClosing = false

  const headingFor = (): string => pendingHeading ?? section

  const flushParagraphs = (): void => {
    if (paragraphs.length === 0) return
    const title = headingFor()
    const groups = splitParagraphs(paragraphs)
    groups.forEach((group, index) => {
      slides.push(
        makeSlide(
          'text',
          index === 0 ? title : `${title} (cont.)`,
          `Source section: ${section}${pendingHeading ? ` → ${pendingHeading}` : ''}`,
          { body: group.join('\n\n') }
        )
      )
    })
    paragraphs = []
    pendingHeading = null
  }

  const isHeading = (block: DocBlock): boolean =>
    block.type === 'heading1' || block.type === 'heading2' || block.type === 'heading3'

  for (let index = 0; index < content.length; index += 1) {
    const block = content[index]

    if (isHeading(block)) {
      flushParagraphs()
      const text = blockText(block.html)
      if (!text) continue

      const next = content.slice(index + 1).find((entry) => entry.type !== 'divider')
      const nextIsHeading = Boolean(next && isHeading(next))
      const closing = CLOSING.test(text)

      if (closing) {
        sawClosing = true
        section = text
        pendingHeading = text
        continue
      }

      if (block.type === 'heading1') {
        section = text
        pendingHeading = text
        // A level-1 heading only gets a divider when subsections follow it.
        if (nextIsHeading) {
          slides.push(makeSlide('section', text, `New section from a level-1 heading: ${text}`))
          pendingHeading = null
        }
        continue
      }

      pendingHeading = text
      continue
    }

    switch (block.type) {
      case 'paragraph': {
        const text = blockText(block.html)
        if (text) paragraphs.push(text)
        break
      }

      case 'bulleted': {
        const title = headingFor()
        flushParagraphs()
        const items = blockText(block.html)
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
        chunk(items, MAX_BULLETS).forEach((group, part) => {
          slides.push(
            makeSlide(
              'bullets',
              part === 0 ? title : `${title} (cont.)`,
              `Bulleted list from section: ${section}`,
              { bullets: group }
            )
          )
        })
        pendingHeading = null
        break
      }

      case 'numbered': {
        const title = headingFor()
        flushParagraphs()
        const items = blockText(block.html)
          .split('\n')
          .map((line) => line.replace(/^\s*\d+[.)]\s*/, '').trim())
          .filter(Boolean)
        chunk(items, MAX_BULLETS).forEach((group, part) => {
          slides.push(
            makeSlide(
              'process',
              part === 0 ? title : `${title} (cont.)`,
              `Numbered list from section: ${section}`,
              { bullets: group }
            )
          )
        })
        pendingHeading = null
        break
      }

      case 'quote': {
        const title = headingFor()
        flushParagraphs()
        const text = blockText(block.html)
        if (!text) break
        slides.push(makeSlide('quote', title, 'Quoted passage.', { quote: text }))
        pendingHeading = null
        break
      }

      case 'code': {
        const title = headingFor()
        flushParagraphs()
        const text = blockText(block.html)
        if (!text) break
        slides.push(
          makeSlide('text', title || 'Code', 'Code block preserved as monospaced text.', {
            body: text
          })
        )
        pendingHeading = null
        break
      }

      case 'table': {
        const title = headingFor()
        flushParagraphs()
        const rows = block.rows ?? []
        if (rows.length === 0) break
        const headers = rows[0].map((cell) => cell || '—')
        const bodyRows = rows.slice(1)
        if (bodyRows.length === 0) break

        chunk(bodyRows, MAX_TABLE_ROWS).forEach((group, part) => {
          const table: SlideTable = { headers, rows: group }
          slides.push(
            makeSlide(
              'table',
              part === 0 ? title : `${title} (cont.)`,
              `Table from section: ${section}`,
              { table }
            )
          )
        })
        pendingHeading = null
        break
      }

      case 'image': {
        const title = headingFor()
        flushParagraphs()
        if (!block.src) break
        slides.push(
          makeSlide('image', title, 'Image preserved from the document.', {
            image: { src: block.src, alt: block.alt ?? '' }
          })
        )
        pendingHeading = null
        break
      }

      case 'divider': {
        flushParagraphs()
        break
      }

      default:
        break
    }
  }

  // A closing slide only when the document actually contains that section.
  if (sawClosing && paragraphs.length > 0) {
    slides.push(
      makeSlide('closing', section, `Closing section: ${section}`, {
        body: paragraphs.join('\n\n')
      })
    )
    paragraphs = []
  }

  flushParagraphs()

  return {
    slides,
    summary: `${slides.length} slides generated from ${blocks.length} blocks using fixed rules (no AI).`
  }
}
