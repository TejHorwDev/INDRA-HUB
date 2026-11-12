import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AccountPanel from '../components/AccountPanel'
import UpdatesPanel from '../components/UpdatesPanel'
import Page from '../components/Page'
import { CheckIcon } from '../components/icons'
import { useSession } from '../lib/session'
import { useTheme } from '../lib/theme'
import type { ThemeMode } from '@shared/types'

const SECTIONS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'account', label: 'Account' },
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
  const { signOut } = useSession()

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

function AboutSection() {
  const [version, setVersion] = useState('0.1.0')

  useEffect(() => {
    const request = window.indra?.getAppVersion()
    if (!request) return
    request.then(setVersion).catch(() => {
      // Keep the fallback version if the bridge is unavailable.
    })
  }, [])

  const versions = window.indra?.versions

  return (
    <>
      <SectionHeading title="About" />

      <dl className="mt-5 max-w-[440px] text-sm">
        <InfoRow label="App" value="INDRA HUB" />
        <InfoRow label="Version" value={version} />
        <InfoRow label="Electron" value={versions?.electron ?? '—'} />
        <InfoRow label="Chromium" value={versions?.chrome ?? '—'} />
        <InfoRow label="Node" value={versions?.node ?? '—'} />
      </dl>
    </>
  )
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
