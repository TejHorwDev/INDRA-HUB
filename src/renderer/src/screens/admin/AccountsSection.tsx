import { useMemo, useState } from 'react'
import type { AdminAccountRow } from '@shared/types'
import ConfirmDialog from '../../components/ConfirmDialog'
import PasswordField from '../../components/PasswordField'
import { useToast } from '../../components/ToastProvider'
import { api, errorMessage } from '../../lib/api'
import {
  Badge,
  SearchField,
  SectionHead,
  formatDate,
  useAdminAction
} from './shared'
import type { SectionProps } from './shared'

type DialogMode = 'reset' | 'delete'

export default function AccountsSection({ overview, refresh }: SectionProps) {
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<AdminAccountRow | null>(null)
  const [mode, setMode] = useState<DialogMode | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [dialogBusy, setDialogBusy] = useState(false)
  const { busy, run } = useAdminAction(refresh)
  const toast = useToast()

  const accounts = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return overview.accounts
    return overview.accounts.filter((account) =>
      [account.displayName, account.username, account.email]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    )
  }, [overview.accounts, query])

  const suspendedCount = overview.accounts.filter((account) => account.suspendedAt).length

  function openDialog(account: AdminAccountRow, next: DialogMode) {
    setTarget(account)
    setMode(next)
    setPassword('')
    setConfirmPassword('')
    setDialogError(null)
  }

  function closeDialog() {
    if (dialogBusy) return
    setTarget(null)
    setMode(null)
    setDialogError(null)
  }

  async function toggleSuspension(account: AdminAccountRow) {
    const suspend = !account.suspendedAt
    await run(
      `status:${account.id}`,
      () => api.admin.suspendAccount(account.id, suspend),
      suspend
        ? `${account.displayName} is suspended and has been signed out.`
        : `${account.displayName} can sign in again.`
    )
  }

  async function endSession(account: AdminAccountRow) {
    try {
      const result = await api.admin.signOutAccount(account.id)
      toast.info(
        result.cleared
          ? `Ended the active session for ${account.displayName}.`
          : 'That account has no active session on this machine.'
      )
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function submitReset() {
    if (!target) return
    if (password.length < 8) {
      setDialogError('Use at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setDialogError('The two passwords do not match.')
      return
    }

    setDialogError(null)
    setDialogBusy(true)
    try {
      await api.admin.resetPassword(target.id, password)
      toast.success(`Password reset for ${target.displayName}. They will need to sign in again.`)
      setTarget(null)
      setMode(null)
      await refresh()
    } catch (error) {
      setDialogError(errorMessage(error))
    } finally {
      setDialogBusy(false)
    }
  }

  async function submitDelete() {
    if (!target) return
    setDialogError(null)
    setDialogBusy(true)
    try {
      await api.admin.deleteAccount(target.id)
      toast.success(`${target.displayName}'s account was deleted.`)
      setTarget(null)
      setMode(null)
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
        title="Accounts"
        description="Every ordinary account on this installation. Suspending one blocks sign-in and ends the session on this machine immediately."
      >
        <SearchField value={query} onChange={setQuery} placeholder="Search accounts" />
      </SectionHead>

      <div className="admin-summary">
        <span>{overview.accounts.length} total</span>
        <span>{overview.accounts.length - suspendedCount} active</span>
        <span>{suspendedCount} suspended</span>
        {overview.sessionUserId && (
          <span>
            Signed in now:{' '}
            {overview.accounts.find((account) => account.id === overview.sessionUserId)
              ?.displayName ?? 'unknown account'}
          </span>
        )}
      </div>

      <section className="admin-card">
        {accounts.length === 0 ? (
          <p className="admin-empty">
            {query ? 'No account matches that search.' : 'No accounts have been created yet.'}
          </p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Email</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="admin-num">
                    Projects
                  </th>
                  <th scope="col" className="admin-num">
                    Content
                  </th>
                  <th scope="col">Joined</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => {
                  const suspended = Boolean(account.suspendedAt)
                  return (
                    <tr key={account.id} className={suspended ? 'admin-row--muted' : undefined}>
                      <td>
                        <span className="admin-strong">{account.displayName}</span>
                        <span className="admin-handle">@{account.username}</span>
                      </td>
                      <td className="admin-dim">{account.email}</td>
                      <td>
                        {suspended ? (
                          <Badge tone="warn">Suspended</Badge>
                        ) : (
                          <Badge tone="good">Active</Badge>
                        )}
                        {overview.sessionUserId === account.id && (
                          <span className="admin-inline-note"> · signed in</span>
                        )}
                      </td>
                      <td className="admin-num">
                        {account.ownedProjects}
                        <span className="admin-subtle"> / {account.memberships}</span>
                      </td>
                      <td className="admin-num">
                        {account.documentCount}
                        <span className="admin-subtle"> / {account.presentationCount}</span>
                      </td>
                      <td className="admin-dim">{formatDate(account.createdAt)}</td>
                      <td>
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            className="admin-action"
                            disabled={busy !== null}
                            onClick={() => void toggleSuspension(account)}
                          >
                            {suspended ? 'Restore' : 'Suspend'}
                          </button>
                          <button
                            type="button"
                            className="admin-action"
                            disabled={busy !== null}
                            onClick={() => openDialog(account, 'reset')}
                          >
                            Reset password
                          </button>
                          <button
                            type="button"
                            className="admin-action"
                            disabled={busy !== null || overview.sessionUserId !== account.id}
                            onClick={() => void endSession(account)}
                          >
                            End session
                          </button>
                          <button
                            type="button"
                            className="admin-action admin-action--danger"
                            disabled={busy !== null}
                            onClick={() => openDialog(account, 'delete')}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="admin-footnote">
        Counts read “owned projects / memberships” and “documents / presentations created”. Deletion
        is only possible once an account owns no projects and created no content.
      </p>

      <ConfirmDialog
        open={mode === 'reset' && target !== null}
        title={`Reset password${target ? ` — ${target.displayName}` : ''}`}
        confirmLabel="Reset password"
        pending={dialogBusy}
        error={dialogError}
        onCancel={closeDialog}
        onConfirm={() => void submitReset()}
      >
        <p>
          Set a new password for <strong>{target?.email}</strong>. Their current session on this
          machine ends, and they sign in with the new password.
        </p>
        <div className="mt-4 space-y-3">
          <PasswordField
            label="New password"
            name="reset-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
          />
          <PasswordField
            label="Confirm password"
            name="reset-confirm"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Repeat the new password"
            autoComplete="new-password"
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={mode === 'delete' && target !== null}
        title={`Delete account${target ? ` — ${target.displayName}` : ''}`}
        confirmLabel="Delete account"
        pending={dialogBusy}
        error={dialogError}
        onCancel={closeDialog}
        onConfirm={() => void submitDelete()}
      >
        <p>
          <strong>{target?.email}</strong> will be removed permanently, along with their team
          memberships. Projects and documents they created are not touched — transfer them first.
        </p>
      </ConfirmDialog>
    </>
  )
}
