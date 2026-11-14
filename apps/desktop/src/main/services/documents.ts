import { randomUUID } from 'node:crypto'
import type {
  DocBlock,
  DocumentDetail,
  DocumentSummary,
  DocumentVersionSummary,
  SessionUser,
  UserSummary
} from '@shared/types'
import { getDatabase } from '../db/database'
import { markDirty } from './sync'
import { errors } from '../lib/errors'
import { cleanHtml, cleanImageSrc } from '../lib/sanitize'
import { projectAccess } from './projects'

const MAX_BLOCKS = 600
const MAX_BLOCK_HTML = 40_000
const MAX_VERSIONS = 30

interface DocumentRow {
  id: string
  project_id: string
  title: string
  content: string
  version: number
  created_by: string
  updated_by: string | null
  created_at: string
  updated_at: string
  creator_name: string
  creator_username: string
  editor_name: string | null
  editor_username: string | null
}

const SELECT_DOCUMENT = `
  SELECT d.*,
         c.display_name AS creator_name, c.username AS creator_username,
         e.display_name AS editor_name,  e.username AS editor_username
    FROM documents d
    JOIN users c ON c.id = d.created_by
    LEFT JOIN users e ON e.id = d.updated_by
`

function user(name: string | null, username: string | null): UserSummary | null {
  if (!name || !username) return null
  return { id: '', username, displayName: name }
}

function toSummary(row: DocumentRow): DocumentSummary {
  const creator = user(row.creator_name, row.creator_username)
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    version: row.version,
    createdBy: creator ?? { id: '', username: 'unknown', displayName: 'Unknown' },
    updatedBy: user(row.editor_name, row.editor_username),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** Drops anything the editor shouldn't be able to persist. */
function sanitizeBlocks(input: unknown): DocBlock[] {
  if (!Array.isArray(input)) throw errors.validation('Document content is invalid.')

  const blocks: DocBlock[] = []
  for (const raw of input.slice(0, MAX_BLOCKS)) {
    if (!raw || typeof raw !== 'object') continue
    const block = raw as Partial<DocBlock>
    if (typeof block.type !== 'string') continue

    const clean: DocBlock = {
      id: typeof block.id === 'string' && block.id ? block.id.slice(0, 64) : randomUUID(),
      type: block.type
    }

    if (typeof block.html === 'string') {
      // Allowlist, not blocklist: see src/main/lib/sanitize.ts for why a plain
      // "strip <script> and on*=" sweep was not enough.
      clean.html = cleanHtml(block.html, MAX_BLOCK_HTML)
    }
    if (Array.isArray(block.rows)) {
      clean.rows = block.rows
        .slice(0, 40)
        .map((row) => (Array.isArray(row) ? row.slice(0, 10).map((cell) => String(cell ?? '').slice(0, 400)) : []))
    }
    if (typeof block.src === 'string') {
      // An image block carries its URL outside the markup, so it gets the same
      // scheme check. An unusable URL is dropped rather than stored.
      const src = cleanImageSrc(block.src.slice(0, 200_000))
      if (src) clean.src = src
    }
    if (typeof block.alt === 'string') clean.alt = block.alt.slice(0, 300)

    blocks.push(clean)
  }
  return blocks
}

function parseContent(raw: string): DocBlock[] {
  try {
    const parsed = JSON.parse(raw) as { blocks?: DocBlock[] }
    if (!Array.isArray(parsed.blocks)) return []
    // Rows written before the allowlist existed still contain whatever was
    // pasted back then, so the read path cleans them too. This is also what
    // makes restoring an old version safe.
    return parsed.blocks.map((block) =>
      typeof block?.html === 'string'
        ? { ...block, html: cleanHtml(block.html, MAX_BLOCK_HTML) }
        : block
    )
  } catch {
    return []
  }
}

function loadDocument(viewer: SessionUser, projectId: string, documentId: string): DocumentRow {
  projectAccess(viewer, projectId)
  const row = getDatabase()
    .prepare(`${SELECT_DOCUMENT} WHERE d.id = ? AND d.project_id = ?`)
    .get(documentId, projectId) as DocumentRow | undefined
  if (!row) throw errors.notFound('Document not found.')
  return row
}

export function listDocuments(viewer: SessionUser, projectId: string): DocumentSummary[] {
  projectAccess(viewer, projectId)
  const rows = getDatabase()
    .prepare(`${SELECT_DOCUMENT} WHERE d.project_id = ? ORDER BY d.updated_at DESC`)
    .all(projectId) as unknown as DocumentRow[]
  return rows.map(toSummary)
}

export function createDocument(
  viewer: SessionUser,
  projectId: string,
  title?: string
): DocumentDetail {
  projectAccess(viewer, projectId)
  const cleanTitle = (title ?? '').trim().slice(0, 120) || 'Untitled document'
  const db = getDatabase()
  const id = randomUUID()
  const now = new Date().toISOString()
  const content = JSON.stringify({
    blocks: [{ id: randomUUID(), type: 'paragraph', html: '' }]
  })

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO documents (id, project_id, title, content, version, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`
    ).run(id, projectId, cleanTitle, content, viewer.id, viewer.id, now, now)
    db.prepare(
      `INSERT INTO document_versions (id, document_id, version, title, content, editor_id, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)`
    ).run(randomUUID(), id, cleanTitle, content, viewer.id, now)
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, projectId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  markDirty(projectId)

  return {
    id,
    projectId,
    title: cleanTitle,
    version: 1,
    createdBy: { id: viewer.id, username: viewer.username, displayName: viewer.displayName },
    updatedBy: { id: viewer.id, username: viewer.username, displayName: viewer.displayName },
    createdAt: now,
    updatedAt: now,
    blocks: parseContent(content)
  }
}

export function getDocument(
  viewer: SessionUser,
  projectId: string,
  documentId: string
): DocumentDetail {
  const row = loadDocument(viewer, projectId, documentId)
  return { ...toSummary(row), blocks: parseContent(row.content) }
}

/**
 * Saves the whole block list as one new version. The client sends the version
 * it edited; a mismatch is reported instead of overwriting newer work.
 */
export function saveDocument(
  viewer: SessionUser,
  projectId: string,
  documentId: string,
  input: { blocks: unknown; title?: unknown; baseVersion?: unknown }
): DocumentDetail {
  const row = loadDocument(viewer, projectId, documentId)
  const baseVersion = Number(input.baseVersion ?? row.version)
  // `Number('abc')` is NaN, which used to slip past the comparison below and
  // let a malformed save overwrite newer work. Reject it instead.
  if (!Number.isInteger(baseVersion) || baseVersion < 1) {
    throw errors.validation('The version this edit was based on is invalid.')
  }
  if (baseVersion !== row.version) {
    throw errors.conflict(
      'This document changed elsewhere. Reload it to get the newest version before saving.'
    )
  }

  const blocks = sanitizeBlocks(input.blocks)
  const title =
    typeof input.title === 'string' && input.title.trim()
      ? input.title.trim().slice(0, 120)
      : row.title
  const nextVersion = row.version + 1
  const now = new Date().toISOString()
  const content = JSON.stringify({ blocks })
  const db = getDatabase()

  db.exec('BEGIN')
  try {
    db.prepare(
      `UPDATE documents SET title = ?, content = ?, version = ?, updated_by = ?, updated_at = ?
        WHERE id = ?`
    ).run(title, content, nextVersion, viewer.id, now, documentId)
    db.prepare(
      `INSERT INTO document_versions (id, document_id, version, title, content, editor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), documentId, nextVersion, title, content, viewer.id, now)
    db.prepare(
      `DELETE FROM document_versions
        WHERE document_id = ?
          AND version NOT IN (
            SELECT version FROM document_versions WHERE document_id = ? ORDER BY version DESC LIMIT ?
          )`
    ).run(documentId, documentId, MAX_VERSIONS)
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, projectId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  markDirty(projectId)

  const saved = loadDocument(viewer, projectId, documentId)
  return { ...toSummary(saved), blocks }
}

export function renameDocument(
  viewer: SessionUser,
  projectId: string,
  documentId: string,
  title: string
): DocumentSummary {
  const row = loadDocument(viewer, projectId, documentId)
  const cleanTitle = (title ?? '').trim().slice(0, 120)
  if (!cleanTitle) throw errors.validation('Give the document a title.', 'title')

  const now = new Date().toISOString()
  getDatabase()
    .prepare('UPDATE documents SET title = ?, updated_at = ?, updated_by = ? WHERE id = ?')
    .run(cleanTitle, now, viewer.id, documentId)
  getDatabase().prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, projectId)

  markDirty(projectId)

  return toSummary({ ...row, title: cleanTitle, updated_at: now, updated_by: viewer.id })
}

export function deleteDocument(
  viewer: SessionUser,
  projectId: string,
  documentId: string
): void {
  const row = loadDocument(viewer, projectId, documentId)
  const db = getDatabase()
  db.exec('BEGIN')
  try {
    // Generated presentations keep their slides but lose the source link.
    db.prepare('UPDATE presentations SET source_document_id = NULL WHERE source_document_id = ?').run(
      documentId
    )
    db.prepare('DELETE FROM documents WHERE id = ?').run(documentId)
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      projectId
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  void row
  markDirty(projectId)
}

export function listVersions(
  viewer: SessionUser,
  projectId: string,
  documentId: string
): DocumentVersionSummary[] {
  loadDocument(viewer, projectId, documentId)
  const rows = getDatabase()
    .prepare(
      `SELECT v.version, v.title, v.created_at, u.display_name, u.username
         FROM document_versions v
         LEFT JOIN users u ON u.id = v.editor_id
        WHERE v.document_id = ?
        ORDER BY v.version DESC
        LIMIT 30`
    )
    .all(documentId) as Array<{
    version: number
    title: string
    created_at: string
    display_name: string | null
    username: string | null
  }>

  return rows.map((row) => ({
    version: row.version,
    title: row.title,
    createdAt: row.created_at,
    editor: user(row.display_name, row.username)
  }))
}

/** Restoring is a new save, so history is never rewritten. */
export function restoreVersion(
  viewer: SessionUser,
  projectId: string,
  documentId: string,
  version: number
): DocumentDetail {
  const row = loadDocument(viewer, projectId, documentId)
  const snapshot = getDatabase()
    .prepare('SELECT content FROM document_versions WHERE document_id = ? AND version = ?')
    .get(documentId, version) as { content: string } | undefined
  if (!snapshot) throw errors.notFound('That version no longer exists.')

  const blocks = parseContent(snapshot.content)
  return saveDocument(viewer, projectId, documentId, {
    blocks,
    title: row.title,
    baseVersion: row.version
  })
}
