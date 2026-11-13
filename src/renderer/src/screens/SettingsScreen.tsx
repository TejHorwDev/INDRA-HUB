import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AboutCard from '../components/AboutCard'
import AccountPanel from '../components/AccountPanel'
import UpdatesPanel from '../components/UpdatesPanel'
import Page from '../components/Page'
import { CheckIcon } from '../components/icons'
import { api, errorMessage } from '../lib/api'
import { useConnectivity } from '../lib/connectivity'
import { useSession } from '../lib/session'
import { useTheme } from '../lib/theme'
import type { CloudState, ThemeMode } from '@shared/types'

const SECTIONS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'account', label: 'Account' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'updates', label: 'Updates' },
  { id: 'about', label: 'About' }
] as const

type SectionId = (typeof SECTIONS)[number]['id']

export default function SettingsScreen() {
  const [section, setSection] = useState<SectionId>('appearance')

  return (
    <Page title="Settings">
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="settings-nav-item"
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <section className="settings-panel">
          {section === 'appearance' && <AppearanceSection />}
          {section === 'account' && <AccountSection />}
          {section === 'cloud' && <CloudSection />}
          {section === 'updates' && <UpdatesPanel />}
          {section === 'about' && <AboutSection />}
        </section>
      </div>
    </Page>
  )
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme()

  return (
    <>
      <SectionHeading title="Appearance" />

      <div className="mt-5 grid max-w-[440px] grid-cols-2 gap-3">
        <ThemeOption mode="light" selected={theme === 'light'} onSelect={setTheme} />
        <ThemeOption mode="dark" selected={theme === 'dark'} onSelect={setTheme} />
      </div>

      <p className="mt-4 max-w-[440px] text-sm text-[var(--ink-tertiary)]">
        Your choice is remembered on this device and applies everywhere in the app.
      </p>
    </>
  )
}

function ThemeOption({
  mode,
  selected,
  onSelect
}: {
  mode: ThemeMode
  selected: boolean
  onSelect: (mode: ThemeMode) => void
}) {
  return (
    <button
      type="button"
      className="theme-option"
      aria-pressed={selected}
      onClick={() => onSelect(mode)}
    >
      <span className={`theme-preview theme-preview--${mode}`} aria-hidden="true">
        <span className="theme-preview-side" />
        <span className="theme-preview-body">
          <span className="theme-preview-bar" />
          <span className="theme-preview-bar theme-preview-bar--short" />
          <span className="theme-preview-bar" />
        </span>
      </span>

      <span className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--ink)]">
          {mode === 'light' ? 'Light' : 'Dark'}
        </span>
        {selected && (
          <span className="theme-check">
            <CheckIcon size={11} />
          </span>
        )}
      </span>
    </button>
  )
}

function AccountSection() {
  const navigate = useNavigate()
  const { signOut, user } = useSession()

  if (user?.mode === 'offline') {
    return (
      <>
        <SectionHeading title="Account" />
        <div className="account-section">
          <p className="account-note">
            This is the offline workspace, not an account. Everything you write is saved on this PC.
            Signing in is what puts work in an account and reaches the cloud.
          </p>
          <div className="account-actions mt-4">
            <button
              type="button"
              className="btn btn-ghost w-auto"
              onClick={() => {
                void signOut().then(() => navigate('/login', { replace: true }))
              }}
            >
              Sign in instead
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <SectionHeading title="Account" />

      <AccountPanel />

      <div className="account-section">
        <h3 className="account-subhead">Session</h3>
        <p className="account-note">
          This account lives in the local database on this device, and the session is remembered for
          30 days.
        </p>
        <div className="account-actions">
          <button
            type="button"
            className="btn btn-ghost w-auto"
            onClick={() => {
              void signOut().then(() => navigate('/login', { replace: true }))
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </>
  )
}

/**
 * The cloud copy, as this PC sees it.
 *
 * The address shown is a generated one that belongs to this installation, and
 * the button forgets it. Nothing on this PC is deleted: the working copy is
 * still here, and the copies in the cloud still belong to the account.
 */
function CloudSection() {
  const { offline } = useConnectivity()
  const { user } = useSession()
  const [state, setState] = useState<CloudState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [adopting, setAdopting] = useState(false)
  const [entered, setEntered] = useState('')

  useEffect(() => {
    let cancelled = false
    void api.cloud
      .state()
      .then((next) => {
        if (!cancelled) setState(next)
      })
      .catch(() => {
        if (!cancelled) setState(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function reveal(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.cloud.key()
      setCode(result.code)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  async function adopt(): Promise<void> {
    if (adopting || entered.trim().length === 0) return
    setAdopting(true)
    setError(null)
    try {
      setState(await api.cloud.adopt(entered.trim()))
      setEntered('')
      setCode(null)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setAdopting(false)
    }
  }

  async function forget(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await api.cloud.forget()
      setState(await api.cloud.state())
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  if (user?.mode === 'offline') {
    return (
      <>
        <SectionHeading title="Cloud" />
        <div className="account-section">
          <p className="account-note">
            The cloud belongs to an account. This PC is in the offline workspace, so there is
            nothing here to save to it or bring back from it. Sign in to use the cloud copy.
          </p>
        </div>
      </>
    )
  }

  return (
    <>
      <SectionHeading title="Cloud" />

      <div className="account-section">
        <dl className="mt-4 max-w-[440px] text-sm">
          <InfoRow
            label="Status"
            value={
              !state
                ? '—'
                : !state.available
                  ? 'Not configured'
                  : state.linked
                    ? offline
                      ? 'Saved, unavailable offline'
                      : 'Linked'
                    : 'Nothing saved yet'
            }
          />
          {state?.account && <InfoRow label="This PC" value={state.account} />}
        </dl>

        <p className="account-note mt-4">
          Saving a project to the cloud writes a copy to this installation’s own space in the
          project database. It is a backup and a way to bring work to another PC — never the working
          copy. Offline, the cloud is not shown and not used; everything on this PC keeps working.
        </p>

        {error && (
          <p className="home-error mt-3" role="alert">
            {error}
          </p>
        )}

        {state?.linked && (
          <div className="account-actions mt-4">
            <button type="button" className="btn btn-ghost w-auto" onClick={() => void reveal()} disabled={busy}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
              {code ? 'Hide transfer code' : 'Move to another PC'}
            </button>
            <button type="button" className="btn btn-ghost w-auto" onClick={() => void forget()} disabled={busy}>
              Sign this PC out of the cloud
            </button>
          </div>
        )}

        {code && (
          <>
            <p className="account-note mt-4">
              Enter this on the other PC under Cloud → Use a code. It is a credential: anyone holding
              it can save to this cloud copy, so treat it like a password.
            </p>
            <code className="cloud-code">{code}</code>
            <div className="account-actions mt-3">
              <button
                type="button"
                className="btn btn-ghost w-auto"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(code)
                    .then(() => setCode(null))
                    .catch(() => undefined)
                }}
              >
                Copy and hide
              </button>
            </div>
          </>
        )}

        <div className="cloud-adopt">
          <h3 className="account-subhead">Use a code from another PC</h3>
          <p className="account-note">
            Adopting a code replaces this PC’s cloud identity with the other machine’s. Nothing on
            this PC is deleted; the local cloud badges are cleared.
          </p>
          <div className="cloud-adopt-row">
            <input
              className="field-input"
              value={entered}
              onChange={(event) => setEntered(event.target.value)}
              placeholder="indrahub-cloud-1.…"
              aria-label="Cloud transfer code"
              spellCheck={false}
            />
            <button
              type="button"
              className="btn btn-ghost w-auto"
              onClick={() => void adopt()}
              disabled={adopting || entered.trim().length === 0 || offline}
              title={offline ? 'Joining another PC’s cloud copy needs a connection' : undefined}
            >
              {adopting ? <span className="spinner" aria-hidden="true" /> : null}
              Use code
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * About is a card, not a table.
 *
 * The administrator's portrait is editable from here when an administrator is
 * signed in on this machine — the panel is where they manage the app, and the
 * About card is the one place the result is seen. Everyone else sees the same
 * card read-only.
 */
function AboutSection() {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let active = true
    api.admin
      .status()
      .then((status) => {
        if (active) setIsAdmin(Boolean(status.configured && status.signedIn))
      })
      .catch(() => {
        // No administrator session: the card stays read-only.
      })
    return () => {
      active = false
    }
  }, [])

  return <AboutCard canEditDeveloper={isAdmin} />
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--line)] py-2.5">
      <dt className="text-[var(--ink-secondary)]">{label}</dt>
      <dd className="font-medium text-[var(--ink)]">{value}</dd>
    </div>
  )
}

function SectionHeading({ title }: { title: string }) {
  return <h2 className="text-md font-semibold text-[var(--ink)]">{title}</h2>
}
