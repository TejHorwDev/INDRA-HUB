import { useMemo, useState } from 'react'
import type { AdminProjectRow } from '@shared/types'
import ConfirmDialog from '../../components/ConfirmDialog'
import TextField from '../../components/TextField'
import { useToast } from '../../components/ToastProvider'
import { api, errorMessage } from '../../lib/api'
import { SearchField, SectionHead, formatDate } from './shared'
import type { SectionProps } from './shared'

type DialogMode = 'rename' | 'transfer' | 'delete'

export default function ProjectsSection({ overview, refresh }: SectionProps) {
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<AdminProjectRow | null>(null)
  const [mode, setMode] = useState<DialogMode | null>(null)
  const [name, setName] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [dialogBusy, setDialogBusy] = useState(false)
  const toast = useToast()

  const projects = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return overview.projects
    return overview.projects.filter((project) =>
      [project.name, project.ownerName, project.ownerEmail, project.description]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    )
  }, [overview.projects, query])

  const transferCandidates = useMemo(
    () =>
      overview.accounts.filter(
        (account) => !account.suspendedAt && account.id !== target?.ownerId
      ),
    [overview.accounts, target?.ownerId]
  )

  function openDialog(project: AdminProjectRow, next: DialogMode) {
    setTarget(project)
    setMode(next)
    setName(project.name)
    setOwnerId('')
    setDialogError(null)
  }

  function closeDialog() {
    if (dialogBusy) return
    setTarget(null)
    setMode(null)
    setDialogError(null)
  }

  async function submit() {
    if (!target || !mode) return
    setDialogError(null)
    setDialogBusy(true)
    try {
      if (mode === 'rename') {
        await api.admin.renameProject(target.id, name)
        toast.success('Project renamed.')
      } else if (mode === 'transfer') {
        if (!ownerId) {
          setDialogError('Choose the account that should own this project.')
          return
        }
        await api.admin.transferProject(target.id, ownerId)
        toast.success('Project ownership transferred.')
      } else {
        await api.admin.deleteProject(target.id)
        toast.success(`"${target.name}" and all its content were deleted.`)
      }
      setTarget(null)
      setMode(null)
      await refresh()
    } catch (error) {
      setDialogError(errorMessage(error))
    } finally {
      setDialogBusy(false)
    }
  }

  const dialogTitle =
    mode === 'rename'
      ? `Rename project${target ? ` — ${target.name}` : ''}`
      : mode === 'transfer'
        ? `Transfer ownership${target ? ` — ${target.name}` : ''}`
        : `Delete project${target ? ` — ${target.name}` : ''}`

  return (
    <>
      <SectionHead
        title="Projects"
        description="Every project on the installation, regardless of who owns it. Ownership can move between accounts; deletion also removes the project's documents and presentations."
      >
        <SearchField value={query} onChange={setQuery} placeholder="Search projects" />
      </SectionHead>

      <div className="admin-summary">
        <span>{overview.projects.length} projects</span>
        <span>{overview.counts.documents} documents</span>
        <span>{overview.counts.presentations} presentations</span>
      </div>

      <section className="admin-card">
        {projects.length === 0 ? (
          <p className="admin-empty">
            {query ? 'No project matches that search.' : 'No projects exist yet.'}
          </p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Owner</th>
                  <th scope="col" className="admin-num">
                    Members
                  </th>
                  <th scope="col" className="admin-num">
                    Content
                  </th>
                  <th scope="col">Updated</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <span className="admin-strong">{project.name}</span>
                      {project.description && (
                        <span className="admin-handle admin-clamp">{project.description}</span>
                      )}
                    </td>
                    <td>
                      {project.ownerName}
                      <span className="admin-handle">{project.ownerEmail}</span>
                    </td>
                    <td className="admin-num">{project.memberCount}</td>
                    <td className="admin-num">
                      {project.documentCount}
                      <span className="admin-subtle"> / {project.presentationCount}</span>
                    </td>
                    <td className="admin-dim">{formatDate(project.updatedAt)}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button
                          type="button"
                          className="admin-action"
                          disabled={dialogBusy}
                          onClick={() => openDialog(project, 'rename')}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="admin-action"
                          disabled={dialogBusy || overview.accounts.length < 2}
                          onClick={() => openDialog(project, 'transfer')}
                        >
                          Transfer
                        </button>
                        <button
                          type="button"
                          className="admin-action admin-action--danger"
                          disabled={dialogBusy}
                          onClick={() => openDialog(project, 'delete')}
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
        Content counts read “documents / presentations”. Deleting a project removes its documents,
        version history, presentations and slides in one step.
      </p>

      <ConfirmDialog
        open={mode !== null && target !== null}
        title={dialogTitle}
        confirmLabel={mode === 'delete' ? 'Delete project' : mode === 'rename' ? 'Rename' : 'Transfer'}
        pending={dialogBusy}
        error={dialogError}
        onCancel={closeDialog}
        onConfirm={() => void submit()}
      >
        {mode === 'rename' && (
          <TextField
            label="Project name"
            name="project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={null}
            autoFocus
            maxLength={80}
          />
        )}

        {mode === 'transfer' && (
          <>
            <p>
              The new owner becomes the head developer. The previous owner is not added as a member.
            </p>
            <div className="mt-4">
              <label className="field-label" htmlFor="transfer-owner">
                <span>New owner</span>
              </label>
              <select
                id="transfer-owner"
                className="field-input"
                value={ownerId}
                onChange={(event) => setOwnerId(event.target.value)}
              >
                <option value="">Choose an account…</option>
                {transferCandidates.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.displayName} (@{account.username})
                  </option>
                ))}
              </select>
              {transferCandidates.length === 0 && (
                <p className="admin-hint">
                  There is no other active account to transfer this project to.
                </p>
              )}
            </div>
          </>
        )}

        {mode === 'delete' && (
          <p>
            <strong>{target?.name}</strong> will be deleted permanently, including{' '}
            {target?.documentCount ?? 0} document(s) and {target?.presentationCount ?? 0}{' '}
            presentation(s) with their version history. This cannot be undone.
          </p>
        )}
      </ConfirmDialog>
    </>
  )
}
