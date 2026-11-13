import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AboutInfo, UpdateState } from '@shared/types'
import { useToast } from './ToastProvider'
import { RefreshIcon, UserIcon } from './icons'
import { api, errorMessage } from '../lib/api'

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
  /**
   * `card` draws its own surface (the admin panel). `plain` has none, because
   * it is already sitting inside one (Settings) — two boxes around four facts
   * is what made the first version look cramped.
   */
  variant?: 'card' | 'plain'
  /** Called after a change, so a parent panel can refresh its own snapshot. */
  onDeveloperChange?: (next: AboutInfo) => void
}

export default function AboutCard({
  canEditDeveloper = false,
  variant = 'card',
  onDeveloperChange
}: AboutCardProps) {
  const toast = useToast()
  const [info, setInfo] = useState<AboutInfo | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  /* True when the browser itself refused the bytes — never persisted. */
  const [broken, setBroken] = useState(false)
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

  /*
   * A portrait published from another PC (or repaired by a reconcile) arrives
   * without this window asking. The main process re-reads the record and pushes
   * it; adopting it here is all that is needed, and there is no polling.
   */
  useEffect(() => {
    return api.about.onChange(setInfo)
  }, [])

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

    setBroken(false)
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

  const reach = info?.developer.cloud
    ? 'Shared with every installation.'
    : 'On this PC only. Connect the shared workspace in Cloud & sync to put it on every PC.'

  /*
   * There is no "you are up to date" line and no check button here: Settings →
   * Updates already says both, and repeating it on a card that is meant to be
   * quiet was noise. The rail appears only when there is an update to apply.
   */
  const rail = useMemo((): { text: string; action: string; disabled: boolean } | null => {
    switch (phase) {
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
      default:
        return null
    }
  }, [phase, update])

  return (
    <section
      className={variant === 'plain' ? 'about-card about-card--plain' : 'about-card'}
      aria-label="About INDRA HUB"
    >
      <div className="about-main">
        <div className="about-ident">
          <p className="about-eyebrow">About</p>
          <h2 className="about-name">{info?.appName ?? 'INDRA HUB'}</h2>
          <p className="about-version">
            Version <span>{version}</span>
          </p>
        </div>

        <figure className="about-dev">
          <div className={`about-portrait${photoUrl && !broken ? '' : ' about-portrait--empty'}`}>
            {photoUrl && !broken ? (
              /*
               * An empty alt is deliberate: the caption underneath already says
               * who this is, and if the image ever fails to draw, alt text would
               * paint a word across the circle — which is precisely what a
               * packaged build without blob: in its CSP did. onError falls back to
               * the mark so the card degrades quietly instead.
               */
              <img src={photoUrl} alt="" draggable={false} onError={() => setBroken(true)} />
            ) : (
              <UserIcon size={52} className="about-portrait-mark" />
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

      {/*
       * The one thing an administrator actually needs to know: has this portrait
       * reached the other PCs, or is it only here? Saying "shared with every
       * installation" when it is not would be the kind of claim this card is not
       * allowed to make. It shows only where somebody can act on it — i.e. next
       * to the tools — and never on the public card.
       */}
      {canEditDeveloper && hasPhoto && (
        <p className={`about-dev-reach${info?.developer.cloud ? ' about-dev-reach--shared' : ''}`}>
          <span>{reach}</span>
        </p>
      )}

      {rail && (
        <div className="about-rail">
          <span className={`about-status about-status--${phase}`}>
            <span className="about-status-dot" aria-hidden="true" />
            {rail.text}
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm w-auto"
            onClick={() => (phase === 'ready' ? void install() : undefined)}
            disabled={rail.disabled || checking}
          >
            {phase === 'ready' && <RefreshIcon size={13} />}
            {rail.action}
          </button>
        </div>
      )}

      {failure && <p className="about-error">{failure}</p>}
    </section>
  )
}
