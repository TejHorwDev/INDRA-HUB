import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { FormEvent } from 'react'
import type { CloudPortrait } from '@shared/types'
import { ApiError, api, errorMessage } from '../lib/api'
import { useSession } from '../lib/session'
import ConfirmDialog from './ConfirmDialog'
import PasswordField from './PasswordField'
import PortraitPicker from './PortraitPicker'
import TextField from './TextField'
import { useToast } from './ToastProvider'

/**
 * The signed-in account's own controls: profile, password and deletion. All of
 * it is re-checked in the main process — this form only collects the input.
 */
export default function AccountPanel() {
  const { user, refresh, signOut } = useSession()
  const toast = useToast()
  const navigate = useNavigate()

  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [avatar, setAvatar] = useState(user?.avatar ?? 'initials')
  const [uploadingPortrait, setUploadingPortrait] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileField, setProfileField] = useState<string | null>(null)
  const [cloudPortrait, setCloudPortrait] = useState<CloudPortrait | null>(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  /*
   * The server's copy of the picture, when there is one. Asking is also what
   * backfills an upload for an account that chose its photo before the
   * workspace kept any, so this runs once per picture rather than on a timer.
   */
  useEffect(() => {
    const value = String(user?.avatar ?? '')
    setCloudPortrait(null)
    if (!value.startsWith('photo:')) return

    let live = true
    void api.portrait
      .cloud()
      .then((state) => {
        if (live) setCloudPortrait(state)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [user?.id, user?.avatar])

  useEffect(() => {
    setDisplayName(user?.displayName ?? '')
    setEmail(user?.email ?? '')
    setAvatar(user?.avatar ?? 'initials')
  }, [user?.displayName, user?.email, user?.avatar])

  if (!user) return null

  const profileDirty =
    displayName.trim() !== user.displayName ||
    email.trim() !== user.email ||
    avatar !== (user.avatar ?? 'initials')

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProfileError(null)
    setProfileField(null)

    if (displayName.trim().length < 2) {
      setProfileField('displayName')
      setProfileError('Name must be 2–48 characters.')
      return
    }
    if (!email.includes('@')) {
      setProfileField('email')
      setProfileError('Enter a valid email address.')
      return
    }

    setSavingProfile(true)
    try {
      await api.auth.updateProfile({ displayName: displayName.trim(), email: email.trim(), avatar })
      await refresh()
      toast.success('Profile updated.')
    } catch (error) {
      setProfileField(error instanceof ApiError ? (error.field ?? null) : null)
      setProfileError(errorMessage(error))
    } finally {
      setSavingProfile(false)
    }
  }

  /**
   * A picture is saved the moment it is chosen, not with the form: the file
   * has already been copied into the app by then, and a portrait waiting on a
   * name change is a confusing thing to show.
   */
  async function uploadPortrait(): Promise<void> {
    if (!user) return

    setProfileError(null)
    setProfileField(null)
    setUploadingPortrait(true)

    try {
      const picked = await api.auth.choosePortrait()
      if (!picked) return

      const updated = await api.auth.updateProfile({
        displayName: user.displayName,
        email: user.email,
        avatarPhoto: { bytes: picked.bytes, name: picked.name }
      })
      setAvatar(updated.avatar ?? 'initials')
      await refresh()
      toast.success('Profile picture updated.')
    } catch (error) {
      setProfileField(error instanceof ApiError ? (error.field ?? null) : null)
      setProfileError(errorMessage(error))
    } finally {
      setUploadingPortrait(false)
    }
  }

  /** Removing the picture leaves the initial tile, and forgets the file. */
  async function removePortrait(): Promise<void> {
    if (!user) return

    setProfileError(null)
    setProfileField(null)
    setUploadingPortrait(true)

    try {
      const updated = await api.auth.updateProfile({
        displayName: user.displayName,
        email: user.email,
        avatar: 'initials'
      })
      setAvatar(updated.avatar ?? 'initials')
      await refresh()
      toast.success('Profile picture removed.')
    } catch (error) {
      setProfileField(error instanceof ApiError ? (error.field ?? null) : null)
      setProfileError(errorMessage(error))
    } finally {
      setUploadingPortrait(false)
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordError(null)

    if (newPassword.length < 8) {
      setPasswordError('Use at least 8 characters for the new password.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('The two new passwords do not match.')
      return
    }

    setSavingPassword(true)
    try {
      await api.auth.changePassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Password changed.')
    } catch (error) {
      setPasswordError(errorMessage(error))
    } finally {
      setSavingPassword(false)
    }
  }

  async function deleteAccount() {
    setDeleteError(null)
    if (!deletePassword) {
      setDeleteError('Enter your password to confirm.')
      return
    }

    setDeleting(true)
    try {
      await api.auth.deleteAccount({ password: deletePassword })
      await signOut()
      navigate('/login', { replace: true })
    } catch (error) {
      setDeleteError(errorMessage(error))
      setDeleting(false)
    }
  }

  const lastSignIn = user.lastSignInAt
    ? new Date(user.lastSignInAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      })
    : '—'

  return (
    <>
      <form onSubmit={saveProfile} noValidate>
        <h3 className="account-subhead">Profile</h3>

        {/* One picture, chosen in the system picker. The account owns it;
            every screen just draws it. */}
        <div className="account-portrait">
          <PortraitPicker
            name={displayName || user.displayName}
            avatar={avatar}
            busy={uploadingPortrait}
            disabled={savingProfile}
            onChoose={() => void uploadPortrait()}
            onRemove={() => void removePortrait()}
            hint="PNG, JPEG or WebP · up to 6 MB"
          />
          {cloudPortrait ? (
            <p className="account-cloud-note">
              {cloudPortrait.path
                ? `On this PC and your workspace${
                    cloudPortrait.updatedAt
                      ? ` · ${new Date(cloudPortrait.updatedAt).toLocaleDateString(undefined, {
                          dateStyle: 'medium'
                        })}`
                      : ''
                  }`
                : cloudPortrait.reachable
                  ? 'On this PC. The workspace has no copy yet.'
                  : 'On this PC. The workspace could not be reached.'}
            </p>
          ) : null}
        </div>

        <div className="account-form">
          <TextField
            label="Display name"
            name="displayName"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            error={profileField === 'displayName' ? profileError : null}
            autoComplete="name"
            disabled={savingProfile}
          />
          <TextField
            label="Email"
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={profileField === 'email' ? profileError : null}
            autoComplete="email"
            spellCheck={false}
            disabled={savingProfile}
          />
        </div>

        <dl className="account-meta">
          <div>
            <dt>Username</dt>
            <dd>@{user.username}</dd>
          </div>
          <div>
            <dt>Member since</dt>
            <dd>{new Date(user.createdAt).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt>Last sign-in</dt>
            <dd>{lastSignIn}</dd>
          </div>
        </dl>

        {profileError && !profileField && (
          <p className="admin-error" role="alert">
            {profileError}
          </p>
        )}

        <div className="account-actions">
          <button
            type="submit"
            className="btn btn-primary w-auto"
            disabled={!profileDirty || savingProfile}
          >
            {savingProfile && <span className="spinner" aria-hidden="true" />}
            {savingProfile ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>

      <form onSubmit={savePassword} noValidate className="account-section">
        <h3 className="account-subhead">Password</h3>
        <div className="account-form">
          <PasswordField
            label="Current password"
            name="currentPassword"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            disabled={savingPassword}
          />
          <PasswordField
            label="New password"
            name="newPassword"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            disabled={savingPassword}
          />
          <PasswordField
            label="Confirm new password"
            name="confirmPassword"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Repeat the new password"
            autoComplete="new-password"
            disabled={savingPassword}
          />
        </div>

        {passwordError && (
          <p className="admin-error" role="alert">
            {passwordError}
          </p>
        )}

        <div className="account-actions">
          <button
            type="submit"
            className="btn btn-primary w-auto"
            disabled={!currentPassword || !newPassword || savingPassword}
          >
            {savingPassword && <span className="spinner" aria-hidden="true" />}
            {savingPassword ? 'Changing…' : 'Change password'}
          </button>
        </div>
      </form>

      <div className="account-section account-danger">
        <h3 className="account-subhead">Delete account</h3>
        <p className="account-note">
          Removing your account also removes your team memberships. Projects you own and content you
          created must be transferred or deleted first — the app refuses otherwise.
        </p>
        <div className="account-actions">
          <button
            type="button"
            className="btn btn-ghost w-auto account-danger-button"
            onClick={() => {
              setDeletePassword('')
              setDeleteError(null)
              setDeleteOpen(true)
            }}
          >
            Delete my account
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete your account"
        confirmLabel="Delete account"
        pending={deleting}
        error={deleteError}
        onCancel={() => {
          if (!deleting) setDeleteOpen(false)
        }}
        onConfirm={() => void deleteAccount()}
      >
        <p>
          This cannot be undone. Type your password to confirm that you want to remove your account
          and team memberships.
        </p>
        <div className="mt-4">
          <PasswordField
            label="Password"
            name="delete-password"
            value={deletePassword}
            onChange={(event) => setDeletePassword(event.target.value)}
            placeholder="Your password"
            autoComplete="current-password"
          />
        </div>
      </ConfirmDialog>
    </>
  )
}
