import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AboutInfo, UpdateState } from '@shared/types'
import { useToast } from './ToastProvider'
import { RefreshIcon } from './icons'
import { api, errorMessage } from '../lib/api'
import { formatRelative } from '../lib/format'

/*
 * About.
 *
 * Four facts and one action: the app's name, the version running, the
 * administrator's portrait, and a button that actually updates the installation.
 *
 * Nothing else belongs here — the runtime numbers people never read (Electron,
 * Chromium, Node) stayed in the administration panel's System section, where an
 * administrator diagnosing a build can find them.
 *
 * The update button drives the same main-process updater the Settings → Updates
 * panel uses, and reports its state in one line rather than a progress bar: it
 * is a card, not a console.
 */

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

interface AboutCardProps {
  /** True when a local administrator session can replace the portrait. */
  canEditDeveloper?: boolean
  /** Called after a change, so a parent panel can refresh its own snapshot. */
  onDeveloperChange?: (next: AboutInfo) => void
}

export default function AboutCard({ canEditDeveloper = false, onDeveloperChange }: AboutCardProps) {
  const toast = useToast()
  const [info, setInfo] = useState<AboutInfo | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [checking, setChecking] = useState(false)
  const announced = useRef<string | null>(null)

  const load = useCallback(async () => {
    try {
      setInfo(await api.about.read())
    } catch (error) {
      setFailure(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /* The updater pushes its own state; the card only renders it. */
  useEffect(() => {
    let active = true
    api.updates
      .state()
      .then((state) => {
        if (active) setUpdate(state)
      })
      .catch(() => {
        // The button simply starts as "Check for updates".
      })
    const unsubscribe = api.updates.onState((state) => {
      if (active) setUpdate(state)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  /* One Blob per portrait, keyed by when it was replaced. */
  const stamp = info?.developer.updatedAt ?? null
  const hasPhoto = Boolean(info?.developer.hasPhoto)
  useEffect(() => {
    let active = true
    let made: string | null = null

    if (!hasPhoto) {
      setPhotoUrl(null)
      return
    }

    api.about
      .photo()
      .then((file) => {
        if (!active || !file) return
        const blob = new Blob([toArrayBuffer(file.bytes)], { type: file.mime })
        made = URL.createObjectURL(blob)
        setPhotoUrl(made)
      })
      .catch(() => {
        if (active) setPhotoUrl(null)
      })

    return () => {
      active = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [hasPhoto, stamp])

  useEffect(() => {
    if (!update || update.phase !== 'ready' || !update.version) return
    if (announced.current === update.version) return
    announced.current = update.version
    toast.success(`Version ${update.version} is ready — restart to apply it.`)
  }, [update, toast])

  const check = useCallback(async () => {
    setChecking(true)
    setFailure(null)
    try {
      setUpdate(await api.updates.check())
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setChecking(false)
    }
  }, [])

  const install = useCallback(async () => {
    setChecking(true)
    setFailure(null)
    try {
      await api.updates.install()
    } catch (error) {
      setFailure(errorMessage(error))
      setChecking(false)
    }
  }, [])

  async function choosePhoto() {
    setBusy(true)
    setFailure(null)
    try {
      const next = await api.admin.chooseDeveloperPhoto()
      if (!next) return
      setInfo(next)
      onDeveloperChange?.(next)
      toast.success('The developer photo was updated.')
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function removePhoto() {
    setBusy(true)
    setFailure(null)
    try {
      const next = await api.admin.removeDeveloperPhoto()
      setInfo(next)
      onDeveloperChange?.(next)
      toast.success('The developer photo was removed.')
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const phase = update?.phase ?? 'idle'
  const version = info?.version ?? '—'
  const initial = (info?.appName ?? 'INDRA HUB').trim().charAt(0) || 'I'

  const status = useMemo((): { text: string; action: string; disabled: boolean } => {
    switch (phase) {
      case 'unsupported':
        return { text: 'Updates are handled by the installer.', action: 'Install to update', disabled: true }
      case 'checking':
        return { text: 'Looking for a newer build…', action: 'Checking…', disabled: true }
      case 'available':
      case 'downloading':
        return {
          text: update?.version
            ? `Version ${update.version} is downloading — ${Math.round(update.percent)}%.`
            : 'An update is downloading.',
          action: `${Math.round(update?.percent ?? 0)}%`,
          disabled: true
        }
      case 'ready':
        return {
          text: update?.version ? `Version ${update.version} is downloaded.` : 'An update is downloaded.',
          action: 'Restart to update',
          disabled: false
        }
      case 'up-to-date':
        return {
          text: update?.checkedAt
            ? `Newest version — checked ${formatRelative(update.checkedAt)}.`
            : 'This is the newest version.',
          action: 'Check again',
          disabled: false
        }
      case 'error':
        return { text: 'The last check failed.', action: 'Try again', disabled: false }
      default:
        return {
          text: update?.checkedAt
            ? `Up to date as of ${formatRelative(update.checkedAt)}.`
            : 'Check for a newer build when you want one.',
          action: 'Check for updates',
          disabled: false
        }
    }
  }, [phase, update])

  return (
    <section className="about-card" aria-label="About INDRA HUB">
      <div className="about-main">
        <div className="about-ident">
          <p className="about-eyebrow">About</p>
          <h2 className="about-name">{info?.appName ?? 'INDRA HUB'}</h2>
          <p className="about-version">
            Version <span>{version}</span>
          </p>
        </div>

        <figure className="about-dev">
          <div className={`about-portrait${photoUrl ? '' : ' about-portrait--empty'}`}>
            {photoUrl ? (
              <img src={photoUrl} alt="Developer" draggable={false} />
            ) : (
              <span aria-hidden="true">{initial}</span>
            )}
          </div>
          <figcaption>Developer</figcaption>
          {canEditDeveloper && (
            <div className="about-dev-tools">
              <button type="button" onClick={() => void choosePhoto()} disabled={busy}>
                {busy ? 'Working…' : hasPhoto ? 'Change' : 'Add photo'}
              </button>
              {hasPhoto && (
                <button type="button" onClick={() => void removePhoto()} disabled={busy}>
                  Remove
                </button>
              )}
            </div>
          )}
        </figure>
      </div>

      <div className="about-rail">
        <span className={`about-status about-status--${phase}`}>
          <span className="about-status-dot" aria-hidden="true" />
          {status.text}
        </span>
        <button
          type="button"
          className="btn btn-primary btn-sm w-auto"
          onClick={() => (phase === 'ready' ? void install() : void check())}
          disabled={status.disabled || checking}
        >
          {phase === 'ready' && <RefreshIcon size={13} />}
          {status.action}
        </button>
      </div>

      {failure && <p className="about-error">{failure}</p>}
    </section>
  )
}
