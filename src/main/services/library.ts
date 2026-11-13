import type { LibraryItem, LibrarySnapshot, SessionUser } from '@shared/types'
import { getDatabase } from '../db/database'

/*
 * The library: every document and every presentation this account can reach,
 * in one list, whichever project it happens to live in.
 *
 * This exists because of the offline mode. When the machine has no route out,
 * the workspace narrows to the two things that were always local — writing and
 * building a deck — and a screen that only ever showed one project at a time
 * would have made that a maze. One query, both kinds, no network.
 *
 * Visibility is the same rule the project screens use: owner or active member.
 * It is expressed in SQL here rather than by asking each project in turn, so a
 * hundred projects still cost one read.
 */

const VISIBLE_PROJECTS = `
  SELECT p.id
    FROM projects p
   WHERE p.owner_id = ?
      OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?)
`

interface DocumentRow {
  id: string
  project_id: string
  project_name: string
  title: string
  created_at: string
  updated_at: string
}

interface PresentationRow extends DocumentRow {
  slide_count: number
}

export function listLibraryDocuments(viewer: SessionUser): LibraryItem[] {
  const rows = getDatabase()
    .prepare(
      `SELECT d.id, d.project_id, p.name AS project_name, d.title, d.created_at, d.updated_at
         FROM documents d
         JOIN projects p ON p.id = d.project_id
        WHERE d.project_id IN (${VISIBLE_PROJECTS})
        ORDER BY d.updated_at DESC`
    )
    .all(viewer.id, viewer.id) as unknown as DocumentRow[]

  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))
}

export function listLibraryPresentations(viewer: SessionUser): LibraryItem[] {
  const rows = getDatabase()
    .prepare(
      `SELECT pr.id, pr.project_id, p.name AS project_name, pr.title, pr.created_at, pr.updated_at,
              (SELECT COUNT(*) FROM presentation_slides s WHERE s.presentation_id = pr.id) AS slide_count
         FROM presentations pr
         JOIN projects p ON p.id = pr.project_id
        WHERE pr.project_id IN (${VISIBLE_PROJECTS})
        ORDER BY pr.updated_at DESC`
    )
    .all(viewer.id, viewer.id) as unknown as PresentationRow[]

  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    slideCount: Number(row.slide_count) || 0
  }))
}

export function librarySnapshot(viewer: SessionUser): LibrarySnapshot {
  return {
    documents: listLibraryDocuments(viewer),
    presentations: listLibraryPresentations(viewer)
  }
}
