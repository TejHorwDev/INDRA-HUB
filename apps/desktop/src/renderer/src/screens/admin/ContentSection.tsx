import { useMemo, useState } from 'react'
import type { AdminContentRow } from '@shared/types'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useToast } from '../../components/ToastProvider'
import { api, errorMessage } from '../../lib/api'
import { SearchField, SectionHead, formatDate } from './shared'
import type { SectionProps } from './shared'

type Filter = 'all' | 'document' | 'presentation'

export default function ContentSection({ overview, refresh }: SectionProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [target, setTarget] = useState<AdminContentRow | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [dialogBusy, setDialogBusy] = useState(false)
  const toast = useToast()

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return overview.content.filter((item) => {
      if (filter !== 'all' && item.kind !== filter) return false
      if (!needle) return true
      return [item.title, item.projectName, item.authorName]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [overview.content, filter, query])

  const documentCount = overview.content.filter((item) => item.kind === 'document').length
  const presentationCount = overview.content.length - documentCount

  async function submitDelete() {
    if (!target) return
    setDialogError(null)
    setDialogBusy(true)
    try {
      if (target.kind === 'document') {
        await api.admin.deleteDocument(target.id)
        toast.success(`"${target.title}" was deleted.`)
      } else {
        await api.admin.deletePresentation(target.id)
        toast.success(`"${target.title}" was deleted.`)
      }
      setTarget(null)
      await refresh()
    } catch (error) {
      setDialogError(errorMessage(error))
    } finally {
      setDialogBusy(false)
    }
  }

  return (
    <>
      <SectionHead
        title="Content"
        description="Every document and presentation across all projects. Removing one here removes it for its team too."
      >
        <SearchField value={query} onChange={setQuery} placeholder="Search content" />
      </SectionHead>

      <div className="admin-tabs" role="tablist" aria-label="Content type">
        {(
          [
            ['all', `All ${overview.content.length}`],
            ['document', `Documents ${documentCount}`],
            ['presentation', `Presentations ${presentationCount}`]
          ] as Array<[Filter, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            className={`admin-tab${filter === value ? ' admin-tab--active' : ''}`}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="admin-card">
        {items.length === 0 ? (
          <p className="admin-empty">
            {overview.content.length === 0
              ? 'No documents or presentations exist yet.'
              : 'Nothing matches that search.'}
          </p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Type</th>
                  <th scope="col">Project</th>
                  <th scope="col">Created by</th>
                  <th scope="col" className="admin-num">
                    Units
                  </th>
                  <th scope="col">Updated</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.kind}:${item.id}`}>
                    <td className="admin-strong">{item.title}</td>
                    <td className="admin-dim">
                      {item.kind === 'document' ? 'Document' : 'Presentation'}
                    </td>
                    <td>{item.projectName}</td>
                    <td className="admin-dim">{item.authorName}</td>
                    <td className="admin-num">
                      {item.units}
                      <span className="admin-subtle">
                        {item.kind === 'document' ? ' v' : ' slides'}
                      </span>
                    </td>
                    <td className="admin-dim">{formatDate(item.updatedAt)}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button
                          type="button"
                          className="admin-action admin-action--danger"
                          disabled={dialogBusy}
                          onClick={() => {
                            setTarget(item)
                            setDialogError(null)
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="admin-footnote">
        “Units” is the document version or the slide count. Deleting a source document leaves any
        generated presentation intact, without its source link.
      </p>

      <ConfirmDialog
        open={target !== null}
        title={target ? `Delete ${target.kind} — ${target.title}` : 'Delete content'}
        confirmLabel="Delete"
        pending={dialogBusy}
        error={dialogError}
        onCancel={() => {
          if (!dialogBusy) setTarget(null)
        }}
        onConfirm={() => void submitDelete()}
      >
        <p>
          <strong>{target?.title}</strong> in “{target?.projectName}” will be deleted permanently for
          everyone on the project.
        </p>
      </ConfirmDialog>
    </>
  )
}
