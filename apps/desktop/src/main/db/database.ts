import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATION_COUNT, migrate } from './schema'

let database: DatabaseSync | null = null

function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  return Number(row?.user_version ?? 0)
}

/**
 * Copies the database before a migration rewrites it.
 *
 * A botched migration is the one failure this app could not talk its way out
 * of, so the previous format is kept beside the database — five deep — and an
 * upgrade that goes wrong is recoverable by copying the file back. Only real
 * upgrades copy anything: a fresh install has no history to protect.
 */
function backupBeforeMigrate(file: string, db: DatabaseSync): void {
  const from = schemaVersion(db)
  if (from === 0 || from >= MIGRATION_COUNT || !existsSync(file)) return

  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const directory = join(dirname(file), 'backups')
    mkdirSync(directory, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    copyFileSync(file, join(directory, `${basename(file, '.db')}-v${from}-${stamp}.db`))

    const kept = readdirSync(directory)
      .filter((name) => name.endsWith('.db'))
      .map((name) => ({ name, at: statSync(join(directory, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
    for (const old of kept.slice(5)) rmSync(join(directory, old.name), { force: true })
  } catch (error) {
    // Never block the app on a backup that did not happen.
    console.error('[db] pre-migration backup failed', error)
  }
}

/**
 * One connection for the whole main process. SQLite is synchronous, so every
 * statement runs on the main thread where the data lives — the renderer can
 * only reach it through the IPC surface.
 */
export function getDatabase(): DatabaseSync {
  if (database) return database

  const profile = app.getPath('userData')
  // A profile folder that is missing (fresh Windows account, a cleaned-up
  // temp profile) should be created rather than fail to open.
  mkdirSync(profile, { recursive: true })
  const file = join(profile, 'indra-hub.db')
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 3000')
  backupBeforeMigrate(file, db)
  migrate(db)

  database = db
  return db
}

export function closeDatabase(): void {
  database?.close()
  database = null
}
