import { readFileSync, writeFileSync } from 'node:fs'
import { getDatabase } from '../db/database'
import { basename } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import type { ProjectArchive, ProjectDetail, SessionUser } from '@shared/types'
import { errors } from '../lib/errors'
import { createDocument, getDocument, listDocuments, saveDocument } from './documents'
import { createBlankPresentation, getPresentation, listPresentations, savePresentation } from './presentations'
import { createProject, getProject } from './projects'

/*
 * Saving a project to the PC.
 *
 * Two kinds of copy exist in this product and they are not the same thing:
 *
 *   1. The working copy. It is SQLite, it is on this machine, and it is what
 *      the app reads and writes. It has never needed a connection.
 *   2. A saved copy. One file, portable, chosen by the user, opened later on a
 *      machine that may never see the internet at all.
 *
 * This file is the second. A project goes out as a single JSON document with
 * every document's blocks and every presentation's slides inside it, so a
 * saved project is self-contained: no ids to resolve, no rows to join, nothing
 * left behind on the machine that wrote it.
 *
 * Import never trusts the file. It is parsed, its shape is checked, and the
 * payload then goes through exactly the same sanitisers as a normal save,
 * because a file can be edited by hand and a document body is HTML.
 */

const FORMAT = 'indrahub.project'
const VERSION = 1
const MAX_BYTES = 64 * 1024 * 1024
const MAX_ITEMS = 500

export const ARCHIVE_EXTENSION = 'indrahub'

function stamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

/** Everything a project holds, in a shape that can be written to a file. */
export function archiveProject(viewer: SessionUser, projectId: string): ProjectArchive {
  const project = getProject(viewer, projectId)
  const documents = listDocuments(viewer, projectId).map((summary) => {
    const detail = getDocument(viewer, projectId, summary.id)
    return {
      title: detail.title,
      blocks: detail.blocks,
      createdAt: stamp(detail.createdAt),
      updatedAt: stamp(detail.updatedAt)
    }
  })
  const presentations = listPresentations(viewer, projectId).map((summary) => {
    const detail = getPresentation(viewer, projectId, summary.id)
    return {
      title: detail.title,
      theme: detail.theme,
      slides: detail.slides,
      createdAt: stamp(detail.createdAt),
      updatedAt: stamp(detail.updatedAt)
    }
  })

  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    project: { name: project.name, description: project.description },
    documents,
    presentations
  }
}

export function writeArchive(archive: ProjectArchive, filePath: string): void {
  writeFileSync(filePath, JSON.stringify(archive, null, 2), 'utf8')
}

function parseArchive(raw: string): ProjectArchive {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw errors.validation('That file is not a saved INDRA HUB project.')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw errors.validation('That file is not a saved INDRA HUB project.')
  }

  const archive = parsed as Partial<ProjectArchive>
  if (archive.format !== FORMAT) {
    throw errors.validation('That file is not a saved INDRA HUB project.')
  }
  if (archive.version !== VERSION) {
    throw errors.validation('That project was saved by a newer version of INDRA HUB.')
  }
  if (!archive.project || typeof archive.project.name !== 'string') {
    throw errors.validation('That project file is missing its name.')
  }
  if (!Array.isArray(archive.documents) || !Array.isArray(archive.presentations)) {
    throw errors.validation('That project file is incomplete.')
  }
  if (archive.documents.length + archive.presentations.length > MAX_ITEMS) {
    throw errors.validation('That project holds more work than this app will restore at once.')
  }
  return archive as ProjectArchive
}

function readArchiveFile(filePath: string): string {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    throw errors.validation('That file could not be read.')
  }
  if (raw.length > MAX_BYTES) {
    throw errors.validation('That project file is too large to open.')
  }
  return raw
}

/**
 * Rebuilds a project from a file as a NEW project owned by the caller. Ids are
 * new, so importing the same file twice gives two projects rather than a
 * collision — the same behaviour as copying a folder.
 */
export function restoreArchive(viewer: SessionUser, raw: string): ProjectDetail {
  const archive = parseArchive(raw)
  const project = createProject(viewer, {
    name: archive.project.name.slice(0, 80),
    description: archive.project.description.slice(0, 280)
  })

  /*
   * If any one entry cannot be rebuilt, the half-made project is removed
   * rather than left in the list as a broken shell. Foreign keys cascade, so
   * one delete takes its documents and decks with it.
   */
  try {
    for (const entry of archive.documents) {
      const document = createDocument(viewer, project.id, entry.title)
      // Through the normal save path, so the block sanitiser runs exactly once
      // and on the same code a typed document uses.
      saveDocument(viewer, project.id, document.id, {
        blocks: entry.blocks,
        title: entry.title,
        baseVersion: document.version
      })
    }

    for (const entry of archive.presentations) {
      const presentation = createBlankPresentation(viewer, project.id, entry.title)
      // Slide ids travel in the file, but a primary key is global: opening the
      // same file twice would otherwise collide with the slides it created the
      // first time. They are reissued here, and the file keeps its own.
      const slides = Array.isArray(entry.slides)
        ? entry.slides.map((slide) => ({ ...(slide as Record<string, unknown>), id: undefined }))
        : entry.slides
      savePresentation(viewer, project.id, presentation.id, {
        title: entry.title,
        theme: entry.theme,
        slides
      })
    }
  } catch (error) {
    getDatabase().prepare('DELETE FROM projects WHERE id = ?').run(project.id)
    throw error
  }

  return getProject(viewer, project.id)
}

function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return cleaned || 'project'
}

export async function exportProjectToFile(
  viewer: SessionUser,
  projectId: string,
  window: BrowserWindow | null
): Promise<{ filePath: string } | null> {
  const project = getProject(viewer, projectId)
  const options = {
    title: 'Save a copy to this PC',
    defaultPath: `${slug(project.name)}.${ARCHIVE_EXTENSION}`,
    filters: [{ name: 'INDRA HUB project', extensions: [ARCHIVE_EXTENSION] }]
  }
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null

  writeArchive(archiveProject(viewer, projectId), result.filePath)
  return { filePath: result.filePath }
}

export async function importProjectFromFile(
  viewer: SessionUser,
  window: BrowserWindow | null
): Promise<{ project: ProjectDetail; fileName: string } | null> {
  const options = {
    title: 'Open a saved project',
    properties: ['openFile' as const],
    filters: [{ name: 'INDRA HUB project', extensions: [ARCHIVE_EXTENSION] }]
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null

  const filePath = result.filePaths[0]
  return {
    project: restoreArchive(viewer, readArchiveFile(filePath)),
    fileName: basename(filePath)
  }
}
