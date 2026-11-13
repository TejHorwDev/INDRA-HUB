import Avatar from './Avatar'
import { PlusIcon, UploadIcon } from './icons'

/**
 * One profile picture, and one obvious way to change it.
 *
 * The circle is the control: clicking anywhere on it opens the system's picture
 * picker, and hovering says so with a scrim and an upload mark. Below it are the
 * two things a person might actually want — choose a picture, or remove the one
 * that is there. No gallery of invented options, no hidden input.
 *
 * `photoUrl` is an unsaved preview (registration, where the account does not
 * exist yet). Without it the avatar draws itself from the account's portrait,
 * which may be a stored photo, initials, or — for accounts made before this
 * screen existed — one of the old marks.
 */
export default function PortraitPicker({
  name,
  avatar,
  photoUrl,
  busy,
  disabled,
  onChoose,
  onRemove,
  hint
}: {
  name: string
  avatar?: string | null
  photoUrl?: string | null
  busy?: boolean
  disabled?: boolean
  onChoose: () => void
  onRemove?: () => void
  hint?: string
}) {
  const hasPicture = Boolean(photoUrl) || Boolean(avatar && avatar.startsWith('photo:'))

  return (
    <div className="portrait-pick">
      <span className="portrait-pick-shell">
        <button
          type="button"
          className="portrait-pick-circle"
          onClick={onChoose}
          disabled={disabled || busy}
          aria-label={hasPicture ? 'Change profile picture' : 'Choose a profile picture'}
        >
          {photoUrl ? (
            <img className="avatar-photo" src={photoUrl} alt="" draggable={false} />
          ) : (
            <Avatar name={name} avatar={avatar} size="xl" className="portrait-pick-avatar" />
          )}

          <span className="portrait-pick-shade" aria-hidden="true" />
          <span className="portrait-pick-hover" aria-hidden="true">
            {busy ? <span className="spinner" /> : <UploadIcon size={20} />}
          </span>
        </button>

        <span className="portrait-pick-badge" aria-hidden="true">
          <PlusIcon size={13} />
        </span>
      </span>

      <p className="portrait-pick-name">{name}</p>

      <div className="portrait-pick-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm w-auto"
          onClick={onChoose}
          disabled={disabled || busy}
        >
          {busy ? 'Opening…' : hasPicture ? 'Change picture' : 'Choose picture'}
        </button>

        {hasPicture && onRemove && (
          <button type="button" className="link-quiet portrait-pick-remove" onClick={onRemove} disabled={disabled || busy}>
            Remove
          </button>
        )}
      </div>

      <p className="portrait-pick-hint">{hint ?? 'PNG, JPEG or WebP · up to 6 MB'}</p>
    </div>
  )
}
