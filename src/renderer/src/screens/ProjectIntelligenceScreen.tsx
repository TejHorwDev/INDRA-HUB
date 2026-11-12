import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { ProjectGraph } from '@shared/types'
import EmptyState from '../components/EmptyState'
import Page from '../components/Page'
import ProjectGraphView from '../components/ProjectGraphView'
import ProjectTabs from '../components/ProjectTabs'
import { Skeleton } from '../components/Skeleton'
import { AlertCircleIcon, SparkIcon } from '../components/icons'
import { api, errorMessage } from '../lib/api'

export default function ProjectIntelligenceScreen() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()

  const [graph, setGraph] = useState<ProjectGraph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setGraph(await api.graph.get(projectId))
    } catch (failure) {
      setError(errorMessage(failure))
      setGraph(null)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Page
      title="Project intelligence"
      description="Every person, document and presentation in this project — and how they connect."
      tabs={<ProjectTabs projectId={projectId} />}
      actions={
        <button type="button" className="btn btn-ghost w-auto" onClick={() => void load()}>
          Refresh
        </button>
      }
    >
      {loading ? (
        <Skeleton height={460} radius={8} />
      ) : error ? (
        <EmptyState
          icon={<AlertCircleIcon size={18} />}
          title="Couldn’t build the map"
          description={error}
          action={
            <button type="button" className="btn btn-ghost w-auto" onClick={() => void load()}>
              Try again
            </button>
          }
        />
      ) : graph ? (
        <>
          <div className="graph-summary">
            <span>
              <strong>{graph.counts.members + 1}</strong>{' '}
              {graph.counts.members + 1 === 1 ? 'person' : 'people'}
            </span>
            <span>
              <strong>{graph.counts.documents}</strong>{' '}
              {graph.counts.documents === 1 ? 'document' : 'documents'}
            </span>
            <span>
              <strong>{graph.counts.presentations}</strong>{' '}
              {graph.counts.presentations === 1 ? 'presentation' : 'presentations'}
            </span>
            <span className="graph-summary-note">
              <SparkIcon size={13} /> Drawn from live project data
            </span>
          </div>
          <ProjectGraphView
            graph={graph}
            onOpenDocument={(documentId) =>
              navigate(`/project/${projectId}/documents/${documentId}`)
            }
            onOpenPresentation={(presentationId) =>
              navigate(`/project/${projectId}/presentations/${presentationId}`)
            }
          />
        </>
      ) : null}
    </Page>
  )
}
