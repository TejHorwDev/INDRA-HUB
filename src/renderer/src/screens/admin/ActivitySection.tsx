import { useMemo, useState } from 'react'
import { AUDIT_LABELS, SearchField, SectionHead, formatDateTime } from './shared'
import type { SectionProps } from './shared'

export default function ActivitySection({ overview }: SectionProps) {
  const [query, setQuery] = useState('')

  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return overview.audit
    return overview.audit.filter((entry) =>
      [AUDIT_LABELS[entry.action] ?? entry.action, entry.detail, entry.adminEmail ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle)
    )
  }, [overview.audit, query])

  return (
    <>
      <SectionHead
        title="Activity"
        description="Every administrator action on this installation, newest first. Entries are written by the main process and cannot be edited from the panel."
      >
        <SearchField value={query} onChange={setQuery} placeholder="Search activity" />
      </SectionHead>

      <section className="admin-card">
        {entries.length === 0 ? (
          <p className="admin-empty">No activity matches that search.</p>
        ) : (
          <ul className="admin-audit">
            {entries.map((entry) => (
              <li key={entry.id}>
                <span className="admin-audit-time">{formatDateTime(entry.createdAt)}</span>
                <span className="admin-audit-action">
                  {AUDIT_LABELS[entry.action] ?? entry.action}
                </span>
                <span className="admin-audit-detail admin-audit-detail--wrap">{entry.detail}</span>
                <span className="admin-audit-actor">{entry.adminEmail ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="admin-footnote">
        The newest {overview.audit.length} entries are shown. Passwords and API keys are never
        written to this log.
      </p>
    </>
  )
}
