import { useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import PasswordField from '../../components/PasswordField'
import TextField from '../../components/TextField'
import { useToast } from '../../components/ToastProvider'
import { api, errorMessage } from '../../lib/api'
import { SectionHead, Toggle } from './shared'
import type { SectionProps } from './shared'

export default function AccessSection({ overview, refresh }: SectionProps) {
  const toast = useToast()

  const [allowRegistration, setAllowRegistration] = useState(overview.settings.allowRegistration)
  const [maintenanceMode, setMaintenanceMode] = useState(overview.settings.maintenanceMode)
  const [message, setMessage] = useState(overview.settings.maintenanceMessage)
  const [requireActivationKey, setRequireActivationKey] = useState(
    overview.settings.requireActivationKey
  )
  const [saving, setSaving] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  const [signOutOpen, setSignOutOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const [identityEmail, setIdentityEmail] = useState(overview.admin.email)
  const [identityName, setIdentityName] = useState(overview.admin.displayName)
  const [identityPassword, setIdentityPassword] = useState('')
  const [identityBusy, setIdentityBusy] = useState(false)
  const [identityError, setIdentityError] = useState<string | null>(null)

  const dirty =
    allowRegistration !== overview.settings.allowRegistration ||
    maintenanceMode !== overview.settings.maintenanceMode ||
    requireActivationKey !== overview.settings.requireActivationKey ||
    message.trim() !== overview.settings.maintenanceMessage

  const sessionAccount = overview.accounts.find(
    (account) => account.id === overview.sessionUserId
  )

  async function saveSettings() {
    setSettingsError(null)
    if (maintenanceMode && !message.trim()) {
      setSettingsError('Write a message to show during maintenance.')
      return
    }

    setSaving(true)
    try {
      await api.admin.updateSettings({
        allowRegistration,
        maintenanceMode,
        maintenanceMessage: message.trim(),
        requireActivationKey
      })
      toast.success('App-wide settings saved.')
      await refresh()
    } catch (error) {
      setSettingsError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    setAllowRegistration(overview.settings.allowRegistration)
    setMaintenanceMode(overview.settings.maintenanceMode)
    setRequireActivationKey(overview.settings.requireActivationKey)
    setMessage(overview.settings.maintenanceMessage)
    setSettingsError(null)
  }

  async function signOutEveryone() {
    setSignOutError(null)
    setSigningOut(true)
    try {
      const result = await api.admin.signOutAll()
      setSignOutOpen(false)
      toast.info(
        result.cleared
          ? 'The ordinary session on this machine was ended.'
          : 'No ordinary session is active right now.'
      )
      await refresh()
    } catch (error) {
      setSignOutError(errorMessage(error))
    } finally {
      setSigningOut(false)
    }
  }

  const identityChanged =
    identityEmail.trim().toLowerCase() !== overview.admin.email.toLowerCase() ||
    identityName.trim() !== overview.admin.displayName

  async function saveIdentity() {
    setIdentityError(null)
    if (!identityEmail.trim() || !identityName.trim()) {
      setIdentityError('Enter both an email address and a name.')
      return
    }
    if (!identityPassword) {
      setIdentityError('Confirm the change with your current password.')
      return
    }

    setIdentityBusy(true)
    try {
      await api.admin.updateIdentity({
        email: identityEmail.trim(),
        displayName: identityName.trim(),
        currentPassword: identityPassword
      })
      setIdentityPassword('')
      toast.success('Administrator identity updated. Use the new email the next time you sign in.')
      await refresh()
    } catch (error) {
      setIdentityError(errorMessage(error))
    } finally {
      setIdentityBusy(false)
    }
  }

  async function changePassword() {
    setPasswordError(null)
    if (newPassword.length < 10) {
      setPasswordError('Use at least 10 characters for the new password.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('The two new passwords do not match.')
      return
    }

    setPasswordBusy(true)
    try {
      await api.admin.changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Administrator password changed. Use it the next time you sign in.')
      await refresh()
    } catch (error) {
      setPasswordError(errorMessage(error))
    } finally {
      setPasswordBusy(false)
    }
  }

  return (
    <>
      <SectionHead
        title="Access & controls"
        description="App-wide switches, the ordinary session on this machine, and the administrator credential. Every change is enforced in the main process and written to the activity log."
      />

      <section className="admin-card">
        <div className="admin-card-head">
          <h2>App availability</h2>
          {dirty && <span className="admin-status admin-status--accent">Unsaved changes</span>}
        </div>
        <div className="admin-card-body">
          <Toggle
            checked={allowRegistration}
            onChange={setAllowRegistration}
            label="Allow new accounts"
            description="When off, the Create account screen is closed and the main process rejects every new registration. Existing accounts keep signing in."
            disabled={saving}
          />

          <div className="admin-divider" />

          <Toggle
            checked={requireActivationKey}
            onChange={setRequireActivationKey}
            label="Require an activation key to register"
            description="Every new account then needs an unused key from the Activation keys section. Existing accounts are unaffected. Turn this on before distributing the app."
            disabled={saving}
          />

          <div className="admin-divider" />

          <Toggle
            checked={maintenanceMode}
            onChange={setMaintenanceMode}
            label="Maintenance mode"
            description="When on, the workspace is closed: every signed-in account sees your message instead of their projects. Signing in and registering still work, and the administration panel stays available."
            disabled={saving}
          />

          <div className="mt-4">
            <TextField
              label="Maintenance message"
              name="maintenance-message"
              value={message}
              onChange={(event) => setMessage(event.target.value.slice(0, 280))}
              hint={
                <p className="field-hint">
                  {280 - message.length} characters left · shown to every signed-in account while
                  maintenance is on.
                </p>
              }
              disabled={saving}
            />
          </div>

          {maintenanceMode && (
            <p className="admin-warning">
              Turning this on signs nobody out, but every ordinary data call is refused until it is
              turned off again.
            </p>
          )}

          {settingsError && (
            <p className="admin-error" role="alert">
              {settingsError}
            </p>
          )}

          <div className="admin-form-actions">
            <button
              type="button"
              className="btn btn-ghost w-auto"
              onClick={discard}
              disabled={!dirty || saving}
            >
              Discard
            </button>
            <button
              type="button"
              className="btn btn-primary w-auto"
              onClick={() => void saveSettings()}
              disabled={!dirty || saving}
            >
              {saving && <span className="spinner" aria-hidden="true" />}
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <h2>Ordinary session on this machine</h2>
        </div>
        <div className="admin-card-body">
          {sessionAccount ? (
            <div className="admin-session-row">
              <div>
                <p className="admin-strong">{sessionAccount.displayName}</p>
                <p className="admin-handle">{sessionAccount.email}</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost w-auto"
                onClick={() => {
                  setSignOutError(null)
                  setSignOutOpen(true)
                }}
              >
                Sign out this account
              </button>
            </div>
          ) : (
            <p className="admin-dim">No ordinary account is signed in on this machine.</p>
          )}
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <h2>Administrator identity</h2>
          {identityChanged && <span className="admin-status admin-status--accent">Unsaved changes</span>}
        </div>
        <div className="admin-card-body">
          <div className="admin-form-grid">
            <TextField
              label="Administrator email"
              name="admin-identity-email"
              value={identityEmail}
              onChange={(event) => setIdentityEmail(event.target.value)}
              placeholder="you@gmail.com"
              type="email"
              autoComplete="off"
              spellCheck={false}
              disabled={identityBusy}
            />
            <TextField
              label="Display name"
              name="admin-identity-name"
              value={identityName}
              onChange={(event) => setIdentityName(event.target.value)}
              placeholder="Your name"
              autoComplete="off"
              disabled={identityBusy}
            />
            <PasswordField
              label="Current password"
              name="admin-identity-password"
              value={identityPassword}
              onChange={(event) => setIdentityPassword(event.target.value)}
              placeholder="Confirm with your password"
              autoComplete="current-password"
              disabled={identityBusy}
            />
          </div>

          {identityError && (
            <p className="admin-error" role="alert">
              {identityError}
            </p>
          )}

          <div className="admin-form-actions">
            <button
              type="button"
              className="btn btn-primary w-auto"
              onClick={() => void saveIdentity()}
              disabled={identityBusy || !identityChanged || !identityPassword}
            >
              {identityBusy && <span className="spinner" aria-hidden="true" />}
              {identityBusy ? 'Saving…' : 'Change identity'}
            </button>
          </div>

          <p className="admin-dim">
            The email is the sign-in identity for administration on this machine, and it must be a
            Gmail address. Changing it asks for the current password so a window left signed in
            cannot be pointed at someone else&apos;s address. If the password is ever lost, launch the
            app with <code>--reset-admin</code> to remove the administrator and set it up again.
          </p>
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <h2>Administrator password</h2>
          <span className="admin-card-count">{overview.admin.email}</span>
        </div>
        <div className="admin-card-body">
          <div className="admin-form-grid">
            <PasswordField
              label="Current password"
              name="admin-current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder="Current password"
              autoComplete="current-password"
              disabled={passwordBusy}
            />
            <PasswordField
              label="New password"
              name="admin-new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="At least 10 characters"
              autoComplete="new-password"
              disabled={passwordBusy}
            />
            <PasswordField
              label="Confirm new password"
              name="admin-confirm-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repeat the new password"
              autoComplete="new-password"
              disabled={passwordBusy}
            />
          </div>

          {passwordError && (
            <p className="admin-error" role="alert">
              {passwordError}
            </p>
          )}

          <div className="admin-form-actions">
            <button
              type="button"
              className="btn btn-primary w-auto"
              onClick={() => void changePassword()}
              disabled={passwordBusy || !currentPassword || !newPassword}
            >
              {passwordBusy && <span className="spinner" aria-hidden="true" />}
              {passwordBusy ? 'Changing…' : 'Change password'}
            </button>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={signOutOpen}
        title="Sign out the ordinary account"
        confirmLabel="Sign out"
        pending={signingOut}
        error={signOutError}
        onCancel={() => {
          if (!signingOut) setSignOutOpen(false)
        }}
        onConfirm={() => void signOutEveryone()}
      >
        <p>
          {sessionAccount
            ? `${sessionAccount.displayName} will be returned to the sign-in screen.`
            : 'The current session will be ended.'}{' '}
          Their data stays intact.
        </p>
      </ConfirmDialog>
    </>
  )
}
