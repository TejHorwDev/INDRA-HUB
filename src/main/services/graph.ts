import type { GraphNode, ProjectGraph, SessionUser } from '@shared/types'
import { getProject } from './projects'
import { listDocuments } from './documents'
import { listPresentations } from './presentations'

/** Inspector dates stay readable instead of showing raw ISO timestamps. */
function day(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().slice(0, 10)
}

/**
 * Builds the project intelligence tree from real rows only: the owner, current
 * members, documents, presentations, and document → presentation links.
 */
export function projectGraph(viewer: SessionUser, projectId: string): ProjectGraph {
  const project = getProject(viewer, projectId)
  const documents = listDocuments(viewer, projectId)
  const presentations = listPresentations(viewer, projectId)

  const linkedByDocument = new Map<string, GraphNode[]>()
  const orphans: GraphNode[] = []

  for (const presentation of presentations) {
    const node: GraphNode = {
      id: `presentation:${presentation.id}`,
      kind: 'presentation',
      label: presentation.title,
      detail: 'Presentation',
      meta: {
        Creator: presentation.createdBy.displayName,
        Created: day(presentation.createdAt),
        Updated: day(presentation.updatedAt),
        Slides: String(presentation.slideCount),
        Mode: presentation.conversionMode === 'rule' ? 'Rule-based (offline)' : presentation.conversionMode,
        Source: presentation.sourceDocumentTitle ?? 'None',
        ...(presentation.stale ? { 'Source changed': 'Yes — regenerate to update' } : {})
      }
    }

    if (presentation.sourceDocumentId) {
      const list = linkedByDocument.get(presentation.sourceDocumentId) ?? []
      list.push(node)
      linkedByDocument.set(presentation.sourceDocumentId, list)
    } else {
      orphans.push(node)
    }
  }

  const documentNodes: GraphNode[] = documents.map((document) => ({
    id: `document:${document.id}`,
    kind: 'document',
    label: document.title,
    detail: 'Document',
    meta: {
      Creator: document.createdBy.displayName,
      Created: day(document.createdAt),
      Updated: day(document.updatedAt),
      Version: String(document.version),
      'Presentations': String(linkedByDocument.get(document.id)?.length ?? 0)
    },
    children: linkedByDocument.get(document.id)
  }))

  const memberNodes: GraphNode[] = project.members.map((member) => ({
    id: `member:${member.userId}`,
    kind: 'member',
    label: member.displayName,
    detail: `@${member.username}`,
    meta: {
      Username: `@${member.username}`,
      Role: member.via === 'team' ? 'Team' : 'Member',
      'How they joined': member.via === 'team' ? 'Through the head developer’s team' : 'Invited to this project',
      Joined: day(member.joinedAt)
    }
  }))

  const children: GraphNode[] = [
    {
      id: 'owner',
      kind: 'owner',
      label: project.owner.displayName,
      detail: `@${project.owner.username}`,
      meta: {
        Username: `@${project.owner.username}`,
        Role: 'Head developer',
        'Owns project': 'Yes'
      }
    }
  ]

  if (memberNodes.length > 0) {
    children.push({
      id: 'group:team',
      kind: 'group',
      label: `Team · ${memberNodes.length}`,
      detail: 'Members',
      children: memberNodes
    })
  }

  if (documentNodes.length > 0) {
    children.push({
      id: 'group:documents',
      kind: 'group',
      label: `Documents · ${documentNodes.length}`,
      detail: 'Documents',
      children: documentNodes
    })
  }

  if (orphans.length > 0) {
    children.push({
      id: 'group:presentations',
      kind: 'group',
      label: `Presentations · ${orphans.length}`,
      detail: 'Presentations',
      children: orphans
    })
  }

  return {
    root: {
      id: `project:${project.id}`,
      kind: 'project',
      label: project.name,
      detail: project.description || 'Project',
      meta: {
        'Head developer': project.owner.displayName,
        Created: day(project.createdAt),
        Members: String(project.memberCount + 1),
        Documents: String(documents.length),
        Presentations: String(presentations.length),
        'Your access': project.role === 'owner' ? 'Head developer' : 'Member'
      },
      children
    },
    counts: {
      members: project.memberCount,
      documents: documents.length,
      presentations: presentations.length
    }
  }
}
