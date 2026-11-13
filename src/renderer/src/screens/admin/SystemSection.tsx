import AboutCard from '../../components/AboutCard'
import { SectionHead, formatBytes, formatDateTime } from './shared'
import type { SectionProps } from './shared'

export default function SystemSection({ overview }: SectionProps) {
  const { system, counts } = overview

  return (
    <>
      <SectionHead
        title="System"
        description="What this installation is actually running, read straight from the main process."
      />

      <AboutCard canEditDeveloper />

      <div className="admin-split mt-4">
        <section className="admin-card">
          <div className="admin-card-head">
            <h2>Runtime</h2>
          </div>
          <dl className="admin-kv">
            <div>
              <dt>App</dt>
              <dd>INDRA HUB {system.appVersion}</dd>
            </div>
            <div>
              <dt>Electron</dt>
              <dd>{system.electron}</dd>
            </div>
            <div>
              <dt>Chromium</dt>
              <dd>{system.chrome}</dd>
            </div>
            <div>
              <dt>Node</dt>
              <dd>{system.node}</dd>
            </div>
            <div>
              <dt>Platform</dt>
              <dd>{system.platform}</dd>
            </div>
            <div>
              <dt>Process started</dt>
              <dd>{formatDateTime(system.startedAt)}</dd>
            </div>
          </dl>
        </section>

        <section className="admin-card">
          <div className="admin-card-head">
            <h2>Storage</h2>
          </div>
          <dl className="admin-kv">
            <div>
              <dt>Database file</dt>
              <dd>{formatBytes(system.databaseBytes)}</dd>
            </div>
            <div>
              <dt>Schema version</dt>
              <dd>{system.schemaVersion}</dd>
            </div>
            <div>
              <dt>Accounts</dt>
              <dd>{counts.accounts}</dd>
            </div>
            <div>
              <dt>Projects</dt>
              <dd>{counts.projects}</dd>
            </div>
            <div>
              <dt>Documents</dt>
              <dd>{counts.documents}</dd>
            </div>
            <div>
              <dt>Presentations</dt>
              <dd>
                {counts.presentations}
                <span className="admin-subtle"> · {counts.slides} slides</span>
              </dd>
            </div>
            <div>
              <dt>Team memberships</dt>
              <dd>{counts.memberships}</dd>
            </div>
          </dl>
        </section>
      </div>

      <p className="admin-footnote">
        The database is a local SQLite file in the app’s user-data folder. The size shown is the main
        file; write-ahead log files may add a little more.
      </p>
    </>
  )
}
