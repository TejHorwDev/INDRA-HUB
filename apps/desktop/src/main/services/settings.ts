import type { AdminSettings, AppPublicStatus } from '@shared/types'
import { getDatabase } from '../db/database'

/*
 * App-wide switches that the administrator owns. Every read goes through the
 * database so another window or a restart sees the same answer, and the auth
 * and IPC layers consult these values — the renderer never decides them.
 */

const DEFAULT_MESSAGE = 'INDRA HUB is temporarily unavailable while maintenance is carried out.'

const DEFAULTS: AdminSettings = {
  allowRegistration: true,
  maintenanceMode: false,
  maintenanceMessage: DEFAULT_MESSAGE,
  requireActivationKey: false
}

function readRows(): Map<string, string> {
  const rows = getDatabase().prepare('SELECT key, value FROM app_settings').all() as Array<{
    key: string
    value: string
  }>
  return new Map(rows.map((row) => [row.key, row.value]))
}

export function readSettings(): AdminSettings {
  const rows = readRows()
  return {
    allowRegistration: (rows.get('allow_registration') ?? 'true') === 'true',
    maintenanceMode: (rows.get('maintenance_mode') ?? 'false') === 'true',
    maintenanceMessage: rows.get('maintenance_message') || DEFAULT_MESSAGE,
    requireActivationKey: (rows.get('require_activation_key') ?? 'false') === 'true'
  }
}

export function publicStatus(): AppPublicStatus {
  const settings = readSettings()
  // Whether an administrator exists is not a secret — the database enforces
  // that only one can ever be created. It tells signed-out screens whether to
  // offer the one-time setup or to stay silent.
  const admin = getDatabase().prepare('SELECT 1 FROM admin_users LIMIT 1').get()

  return {
    maintenanceMode: settings.maintenanceMode,
    maintenanceMessage: settings.maintenanceMessage,
    allowRegistration: settings.allowRegistration,
    requireActivationKey: settings.requireActivationKey,
    adminConfigured: Boolean(admin)
  }
}

export function writeSettings(next: AdminSettings): AdminSettings {
  const db = getDatabase()
  const now = new Date().toISOString()
  const statement = db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )

  db.exec('BEGIN')
  try {
    statement.run('allow_registration', String(next.allowRegistration), now)
    statement.run('maintenance_mode', String(next.maintenanceMode), now)
    statement.run('maintenance_message', next.maintenanceMessage, now)
    statement.run('require_activation_key', String(next.requireActivationKey), now)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return next
}

export { DEFAULT_MESSAGE }
