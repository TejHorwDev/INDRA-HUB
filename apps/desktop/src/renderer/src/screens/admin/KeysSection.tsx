import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { CreatedActivationKey } from '@shared/types'
import { useToast } from '../../components/ToastProvider'
import { api, errorMessage } from '../../lib/api'
import { Badge, SectionHead, formatDate, useAdminAction } from './shared'
import type { SectionProps } from './shared'

const STATUS_TONES = {
  unused: 'good',
  used: 'neutral',
  revoked: 'warn',
  expired: 'warn'
} as const

export default function KeysSection({ overview, refresh }: SectionProps) {
  const toast = useToast()
  const { busy, run } = useAdminAction(refresh)

  const [count, setCount] = useState('1')
  const [label, setLabel] = useState('')
  const [days, setDays] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedActivationKey[]>([])

  /*
   * The list comes from the server. Opening the panel pulls it, so the keys on
   * screen are the keys every machine will accept — not a copy that only this
   * PC knows about.
   */
  useEffect(() => {
    void api.admin
      .syncKeys()
      .then(() => refresh())
      .catch(() => undefined)
  }, [refresh])

  const keys = overview.activationKeys
  const available = useMemo(() => keys.filter((key) => key.status === 'unused').length, [keys])

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreateError(null)

    const amount = Math.floor(Number(count))
    if (!Number.isFinite(amount) || amount < 1 || amount > 25) {
      setCreateError('Choose between 1 and 25 keys.')
      return
    }

    const parsedDays = days.trim() === '' ? null : Math.floor(Number(days))
    if (parsedDays !== null && (!Number.isFinite(parsedDays) || parsedDays < 1 || parsedDays > 3650)) {
      setCreateError('Expiry must be between 1 and 3650 days, or left empty.')
      return
    }

    setCreating(true)
    try {
      const keysCreated = await api.admin.createKeys({
        count: amount,
        label: label.trim(),
        expiresInDays: parsedDays
      })
      setCreated(keysCreated)
      setLabel('')
      setCount('1')
      toast.success(`${keysCreated.length} activation key${keysCreated.length === 1 ? '' : 's'} generated.`)
      await refresh()
    } catch (error) {
      setCreateError(errorMessage(error))
    } finally {
      setCreating(false)
    }
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(created.map((key) => key.code).join('\n'))
      toast.success('Codes copied to the clipboard.')
    } catch {
      toast.error('Could not copy automatically — select the codes and copy them manually.')
    }
  }

  async function revoke(id: string) {
    await run('revoke', () => api.admin.revokeKey(id), 'Activation key revoked.')
  }

  async function remove(id: string) {
    await run('delete', () => api.admin.deleteKey(id), 'Activation key deleted.')
  }

  return (
    <>
      <SectionHead
        title="Activation keys"
        description="Local keys that authorise account creation. Only a digest is stored — each code is shown once, here, right after generation."
      />

      <div className="admin-summary">
        <span>{keys.length} total</span>
        <span>{available} unused</span>
        <span>
          {overview.settings.requireActivationKey
            ? 'Required for new accounts'
            : 'Optional right now'}
        </span>
      </div>

      {!overview.settings.requireActivationKey && (
        <p className="admin-warning">
          New accounts do not currently need a key. Turn on “Require activation key” under Access &
          controls when you are ready to gate registration.
        </p>
      )}

      {created.length > 0 && (
        <section className="admin-card admin-codes-card">
          <div className="admin-card-head">
            <h2>Save these codes now</h2>
            <button type="button" className="admin-link" onClick={() => void copyCodes()}>
              Copy all
            </button>
          </div>
          <div className="admin-card-body">
            <p className="admin-hint">
              They will not be shown again. Closing this notice is safe once they are stored
              somewhere secure.
            </p>
            <ul className="admin-code-list">
              {created.map((key) => (
                <li key={key.id}>
                  <span className="admin-code">{key.code}</span>
                  <span className="admin-dim">
                    {key.label || 'No label'} ·{' '}
                    {key.expiresAt ? `expires ${formatDate(key.expiresAt)}` : 'never expires'}
                  </span>
                </li>
              ))}
            </ul>
            <div className="admin-form-actions">
              <button type="button" className="btn btn-ghost w-auto" onClick={() => setCreated([])}>
                I have saved them
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="admin-card">
        <div className="admin-card-head">
          <h2>Generate keys</h2>
        </div>
        <div className="admin-card-body">
          <form onSubmit={generate} className="admin-key-form" noValidate>
            <label className="admin-field">
              <span className="field-label">
                <span>How many</span>
              </span>
              <input
                className="field-input"
                type="number"
                min={1}
                max={25}
                value={count}
                onChange={(event) => setCount(event.target.value)}
                disabled={creating}
              />
            </label>
            <label className="admin-field">
              <span className="field-label">
                <span>Label (optional)</span>
              </span>
              <input
                className="field-input"
                type="text"
                value={label}
                onChange={(event) => setLabel(event.target.value.slice(0, 60))}
                placeholder="e.g. November cohort"
                disabled={creating}
              />
            </label>
            <label className="admin-field">
              <span className="field-label">
                <span>Expires in days (optional)</span>
              </span>
              <input
                className="field-input"
                type="number"
                min={1}
                max={3650}
                value={days}
                onChange={(event) => setDays(event.target.value)}
                placeholder="Never"
                disabled={creating}
              />
            </label>
            <div className="admin-key-form-action">
              <button type="submit" className="btn btn-primary w-auto" disabled={creating}>
                {creating && <span className="spinner" aria-hidden="true" />}
                {creating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </form>
          {createError && (
            <p className="admin-error" role="alert">
              {createError}
            </p>
          )}
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <h2>Issued keys</h2>
          <span className="admin-card-count">{keys.length}</span>
        </div>
        {keys.length === 0 ? (
          <p className="admin-empty">No activation keys have been generated yet.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Key</th>
                  <th scope="col">Label</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                  <th scope="col">Expires</th>
                  <th scope="col">Used by</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id}>
                    <td className="admin-strong admin-code admin-code--inline">{key.maskedCode}</td>
                    <td className="admin-dim">{key.label || '—'}</td>
                    <td>
                      <Badge tone={STATUS_TONES[key.status]}>{key.status}</Badge>
                    </td>
                    <td className="admin-dim">{formatDate(key.createdAt)}</td>
                    <td className="admin-dim">
                      {key.expiresAt ? formatDate(key.expiresAt) : 'Never'}
                    </td>
                    <td className="admin-dim">{key.usedByEmail ?? '—'}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button
                          type="button"
                          className="admin-action"
                          disabled={busy !== null || key.status !== 'unused'}
                          onClick={() => void revoke(key.id)}
                        >
                          Revoke
                        </button>
                        <button
                          type="button"
                          className="admin-action admin-action--danger"
                          disabled={busy !== null || key.status === 'used'}
                          onClick={() => void remove(key.id)}
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
        Keys can be revoked while unused; used keys stay as a record of the account they created.
        When you move the app online, this same step can validate a hosted licensing service instead.
      </p>
    </>
  )
}
