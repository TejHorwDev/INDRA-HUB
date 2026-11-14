import { randomUUID } from 'node:crypto'
import type {
  ConversionMode,
  PresentationDetail,
  PresentationSummary,
  PresentationTheme,
  SessionUser,
  Slide,
  SlideLayout,
  UserSummary
} from '@shared/types'
import { PRESENTATION_THEMES } from '@shared/types'
import { getDatabase } from '../db/database'
import { markDirty } from './sync'
import { convertDocumentToSlides } from '../lib/convert'
import { errors } from '../lib/errors'
import { getDocument } from './documents'
import { projectAccess } from './projects'

const LAYOUTS: SlideLayout[] = [
  'title',
  'section',
  'text',
  'bullets',
  'process',
  'quote',
  'table',
  'image',
  'closing'
]

interface PresentationRow {
  id: string
  project_id: string
  title: string
  theme: PresentationTheme
  conversion_mode: ConversionMode
  source_document_id: string | null
  source_document_version: number | null
  created_by: string
  created_at: string
  updated_at: string
  creator_name: string
  creator_username: string
  source_title: string | null
  source_version_now: number | null
  slide_count: number
}

const SELECT_PRESENTATION = `
  SELECT p.*,
         c.display_name AS creator_name, c.username AS creator_username,
         d.title AS source_title, d.version AS source_version_now,
         (SELECT COUNT(*) FROM presentation_slides s WHERE s.presentation_id = p.id) AS slide_count
    FROM presentations p
    JOIN users c ON c.id = p.created_by
    LEFT JOIN documents d ON d.id = p.source_document_id
`

function toSummary(row: PresentationRow): PresentationSummary {
  const createdBy: UserSummary = {
    id: row.created_by,
    username: row.creator_username,
    displayName: row.creator_name
  }
  const stale =
    row.source_document_id !== null &&
    row.source_document_version !== null &&
    row.source_version_now !== null &&
    row.source_version_now > row.source_document_version

  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    theme: row.theme,
    conversionMode: row.conversion_mode,
    sourceDocumentId: row.source_document_id,
    sourceDocumentTitle: row.source_title,
    sourceDocumentVersion: row.source_document_version,
    slideCount: Number(row.slide_count ?? 0),
    createdBy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stale
  }
}

function loadPresentation(
  viewer: SessionUser,
  projectId: string,
  presentationId: string
): PresentationRow {
  projectAccess(viewer, projectId)
  const row = getDatabase()
    .prepare(`${SELECT_PRESENTATION} WHERE p.id = ? AND p.project_id = ?`)
    .get(presentationId, projectId) as PresentationRow | undefined
  if (!row) throw errors.notFound('Presentation not found.')
  return row
}

function readSlides(presentationId: string): Slide[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, layout, content, notes
         FROM presentation_slides
        WHERE presentation_id = ?
        ORDER BY position ASC`
    )
    .all(presentationId) as Array<{ id: string; layout: string; content: string; notes: string }>

  return rows.map((row) => {
    let content: Partial<Slide> = {}
    try {
      content = JSON.parse(row.content) as Partial<Slide>
    } catch {
      content = {}
    }
    return {
      id: row.id,
      layout: (LAYOUTS.includes(row.layout as SlideLayout) ? row.layout : 'text') as SlideLayout,
      title: content.title ?? '',
      body: content.body,
      bullets: content.bullets,
      quote: content.quote,
      table: content.table,
      image: content.image,
      notes: row.notes ?? ''
    }
  })
}

function sanitizeSlide(slide: unknown): { layout: SlideLayout; content: string; notes: string } {
  const raw = (slide ?? {}) as Partial<Slide>
  const layout = LAYOUTS.includes(raw.layout as SlideLayout) ? (raw.layout as SlideLayout) : 'text'
  const clean = {
    title: typeof raw.title === 'string' ? raw.title.slice(0, 200) : '',
    body: typeof raw.body === 'string' ? raw.body.slice(0, 8000) : undefined,
    bullets: Array.isArray(raw.bullets)
      ? raw.bullets.slice(0, 12).map((line) => String(line).slice(0, 300))
      : undefined,
    quote: typeof raw.quote === 'string' ? raw.quote.slice(0, 2000) : undefined,
    table:
      raw.table && Array.isArray(raw.table.headers) && Array.isArray(raw.table.rows)
        ? {
            headers: raw.table.headers.slice(0, 10).map((cell) => String(cell).slice(0, 200)),
            rows: raw.table.rows
              .slice(0, 12)
              .map((row) => (Array.isArray(row) ? row.slice(0, 10).map((cell) => String(cell).slice(0, 200)) : []))
          }
        : undefined,
    image:
      raw.image && typeof raw.image.src === 'string'
        ? { src: raw.image.src.slice(0, 200_000), alt: String(raw.image.alt ?? '').slice(0, 300) }
        : undefined
  }
  return {
    layout,
    content: JSON.stringify(clean),
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 4000) : ''
  }
}

function writeSlides(presentationId: string, slides: unknown): void {
  if (!Array.isArray(slides) || slides.length === 0) {
    throw errors.validation('A presentation needs at least one slide.')
  }
  if (slides.length > 200) throw errors.validation('That presentation has too many slides.')

  const db = getDatabase()
  db.prepare('DELETE FROM presentation_slides WHERE presentation_id = ?').run(presentationId)
  const insert = db.prepare(
    `INSERT INTO presentation_slides (id, presentation_id, position, layout, content, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  slides.forEach((slide, index) => {
    const clean = sanitizeSlide(slide)
    const providedId = (slide as Slide)?.id
    insert.run(
      typeof providedId === 'string' && providedId ? providedId.slice(0, 64) : randomUUID(),
      presentationId,
      index,
      clean.layout,
      clean.content,
      clean.notes
    )
  })
}

export function listPresentations(
  viewer: SessionUser,
  projectId: string
): PresentationSummary[] {
  projectAccess(viewer, projectId)
  const rows = getDatabase()
    .prepare(`${SELECT_PRESENTATION} WHERE p.project_id = ? ORDER BY p.updated_at DESC`)
    .all(projectId) as unknown as PresentationRow[]
  return rows.map(toSummary)
}

export function getPresentation(
  viewer: SessionUser,
  projectId: string,
  presentationId: string
): PresentationDetail {
  const row = loadPresentation(viewer, projectId, presentationId)
  return { ...toSummary(row), slides: readSlides(presentationId) }
}

export function createBlankPresentation(
  viewer: SessionUser,
  projectId: string,
  title?: string
): PresentationDetail {
  projectAccess(viewer, projectId)
  const cleanTitle = (title ?? '').trim().slice(0, 120) || 'Untitled presentation'
  const db = getDatabase()
  const id = randomUUID()
  const now = new Date().toISOString()

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO presentations (id, project_id, title, theme, conversion_mode, source_document_id,
                                  source_document_version, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'minimal', 'blank', NULL, NULL, ?, ?, ?)`
    ).run(id, projectId, cleanTitle, viewer.id, now, now)
    writeSlides(id, [
      { id: randomUUID(), layout: 'title', title: cleanTitle, body: '', notes: '' }
    ])
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, projectId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  markDirty(projectId)

  return getPresentation(viewer, projectId, id)
}

/**
 * The offline converter: reads the saved document, applies fixed rules and
 * writes a real presentation. No network, no AI, no external service.
 */
export function convertDocument(
  viewer: SessionUser,
  projectId: string,
  documentId: string
): PresentationDetail {
  const document = getDocument(viewer, projectId, documentId)
  const { slides } = convertDocumentToSlides(document.title, document.blocks)

  const db = getDatabase()
  const id = randomUUID()
  const now = new Date().toISOString()
  const title = `${document.title} — presentation`

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO presentations (id, project_id, title, theme, conversion_mode, source_document_id,
                                  source_document_version, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'minimal', 'rule', ?, ?, ?, ?, ?)`
    ).run(id, projectId, title, documentId, document.version, viewer.id, now, now)
    writeSlides(id, slides)
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, projectId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  markDirty(projectId)

  return getPresentation(viewer, projectId, id)
}

export function savePresentation(
  viewer: SessionUser,
  projectId: string,
  presentationId: string,
  input: { title?: unknown; theme?: unknown; slides?: unknown }
): PresentationDetail {
  loadPresentation(viewer, projectId, presentationId)
  const db = getDatabase()
  const now = new Date().toISOString()

  const theme =
    typeof input.theme === 'string' && (PRESENTATION_THEMES as readonly string[]).includes(input.theme)
      ? (input.theme as PresentationTheme)
      : undefined
  const title =
    typeof input.title === 'string' && input.title.trim()
      ? input.title.trim().slice(0, 120)
      : undefined

  db.exec('BEGIN')
  try {
    if (title) {
      db.prepare('UPDATE presentations SET title = ? WHERE id = ?').run(title, presentationId)
    }
    if (theme) {
      db.prepare('UPDATE presentations SET theme = ? WHERE id = ?').run(theme, presentationId)
    }
    if (input.slides !== undefined) writeSlides(presentationId, input.slides)
    db.prepare('UPDATE presentations SET updated_at = ? WHERE id = ?').run(now, presentationId)
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, projectId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  markDirty(projectId)

  return getPresentation(viewer, projectId, presentationId)
}

export function duplicatePresentation(
  viewer: SessionUser,
  projectId: string,
  presentationId: string
): PresentationDetail {
  const source = getPresentation(viewer, projectId, presentationId)
  const db = getDatabase()
  const id = randomUUID()
  const now = new Date().toISOString()

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO presentations (id, project_id, title, theme, conversion_mode, source_document_id,
                                  source_document_version, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      projectId,
      `${source.title} (copy)`.slice(0, 120),
      source.theme,
      source.conversionMode,
      source.sourceDocumentId,
      source.sourceDocumentVersion,
      viewer.id,
      now,
      now
    )
    writeSlides(
      id,
      source.slides.map((slide) => ({ ...slide, id: randomUUID() }))
    )
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, projectId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  markDirty(projectId)

  return getPresentation(viewer, projectId, id)
}

export function deletePresentation(
  viewer: SessionUser,
  projectId: string,
  presentationId: string
): void {
  loadPresentation(viewer, projectId, presentationId)
  getDatabase().prepare('DELETE FROM presentations WHERE id = ?').run(presentationId)
  getDatabase()
    .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), projectId)
  markDirty(projectId)
}
