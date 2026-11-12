import { app } from 'electron'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from './schema'

let database: DatabaseSync | null = null

/**
 * One connection for the whole main process. SQLite is synchronous, so every
 * statement runs on the main thread where the data lives — the renderer can
 * only reach it through the IPC surface.
 */
export function getDatabase(): DatabaseSync {
  if (database) return database

  const file = join(app.getPath('userData'), 'indra-hub.db')
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 3000')
  migrate(db)

  database = db
  return db
}

export function closeDatabase(): void {
  database?.close()
  database = null
}
