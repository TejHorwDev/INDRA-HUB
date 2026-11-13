import type { DatabaseSync } from 'node:sqlite'

/**
 * Versioned migrations. Each entry runs exactly once, in order, inside a
 * transaction; `PRAGMA user_version` records how far the database has got.
 */
const MIGRATIONS: string[] = [
  /* 1 — accounts, projects, memberships, app state */ `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name  TEXT NOT NULL,
    email         TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE INDEX projects_owner_idx ON projects(owner_id);

  CREATE TABLE project_members (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member')),
    joined_at  TEXT NOT NULL,
    PRIMARY KEY (project_id, user_id)
  );

  CREATE INDEX project_members_user_idx ON project_members(user_id);

  /* The head developer is the owner, never an ordinary member row. */
  CREATE TRIGGER project_members_reject_owner
  BEFORE INSERT ON project_members
  WHEN NEW.user_id = (SELECT owner_id FROM projects WHERE id = NEW.project_id)
  BEGIN
    SELECT RAISE(ABORT, 'owner_cannot_be_member');
  END;

  CREATE TABLE app_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  /* 2 — documents, versions, presentations, slides */ `
  CREATE TABLE documents (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '{"blocks":[]}',
    version     INTEGER NOT NULL DEFAULT 1,
    created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE INDEX documents_project_idx ON documents(project_id, updated_at DESC);

  CREATE TABLE document_versions (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    editor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL,
    UNIQUE(document_id, version)
  );

  CREATE INDEX document_versions_doc_idx ON document_versions(document_id, version DESC);

  CREATE TABLE presentations (
    id                      TEXT PRIMARY KEY,
    project_id              TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title                   TEXT NOT NULL,
    theme                   TEXT NOT NULL DEFAULT 'minimal',
    conversion_mode         TEXT NOT NULL CHECK (conversion_mode IN ('blank','rule','ai')),
    source_document_id      TEXT REFERENCES documents(id) ON DELETE SET NULL,
    source_document_version INTEGER,
    created_by              TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL
  );

  CREATE INDEX presentations_project_idx ON presentations(project_id, updated_at DESC);
  CREATE INDEX presentations_source_idx ON presentations(source_document_id);

  CREATE TABLE presentation_slides (
    id              TEXT PRIMARY KEY,
    presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
    position        INTEGER NOT NULL,
    layout          TEXT NOT NULL,
    content         TEXT NOT NULL,
    notes           TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX presentation_slides_pres_idx ON presentation_slides(presentation_id, position);
  `,

  /* 3 — administrator identity and its audit trail */ `
  CREATE TABLE admin_users (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name    TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    password_salt   TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    last_sign_in_at TEXT
  );

  /* One administrator per installation, enforced by the database itself. */
  CREATE TRIGGER admin_users_single
  BEFORE INSERT ON admin_users
  WHEN (SELECT COUNT(*) FROM admin_users) > 0
  BEGIN
    SELECT RAISE(ABORT, 'admin_already_configured');
  END;

  CREATE TABLE admin_audit (
    id         TEXT PRIMARY KEY,
    admin_id   TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
    action     TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE INDEX admin_audit_created_idx ON admin_audit(created_at DESC);
  `,

  /* 4 — account suspension and app-wide settings */ `
  ALTER TABLE users ADD COLUMN suspended_at TEXT;

  CREATE TABLE app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  INSERT INTO app_settings (key, value, updated_at) VALUES
    ('allow_registration', 'true', datetime('now')),
    ('maintenance_mode', 'false', datetime('now')),
    ('maintenance_message', 'INDRA HUB is temporarily unavailable while maintenance is carried out.', datetime('now'));
  `,

  /* 5 — account lifecycle fields and local activation keys */ `
  ALTER TABLE users ADD COLUMN last_sign_in_at TEXT;
  ALTER TABLE users ADD COLUMN password_changed_at TEXT;
  ALTER TABLE users ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN locked_until TEXT;

  CREATE TABLE activation_keys (
    id              TEXT PRIMARY KEY,
    code_hash       TEXT NOT NULL UNIQUE,
    masked_code     TEXT NOT NULL,
    label           TEXT NOT NULL DEFAULT '',
    created_by      TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL,
    expires_at      TEXT,
    used_at         TEXT,
    used_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    revoked_at      TEXT
  );

  CREATE INDEX activation_keys_state_idx ON activation_keys(revoked_at, used_at);

  INSERT INTO app_settings (key, value, updated_at)
  VALUES ('require_activation_key', 'false', datetime('now'));
  `,

  /* 6 — administrator-installed media for the signed-out screens */ `
  CREATE TABLE media_assets (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,
    file_name     TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime          TEXT NOT NULL,
    bytes         INTEGER NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE INDEX media_assets_kind_idx ON media_assets(kind, created_at);

  INSERT INTO app_settings (key, value, updated_at) VALUES
    ('login_background_asset', '', datetime('now')),
    ('login_background_blur', '18', datetime('now')),
    ('login_background_dim', '46', datetime('now'));
  `,

  /* 7 — teams: one per owner, with a roster of colleagues */ `
  CREATE TABLE teams (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  /* One team per person, enforced by the database rather than the UI. */
  CREATE UNIQUE INDEX teams_owner_idx ON teams(owner_id);

  CREATE TABLE team_members (
    team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member')),
    joined_at TEXT NOT NULL,
    PRIMARY KEY (team_id, user_id)
  );

  CREATE INDEX team_members_user_idx ON team_members(user_id);

  /* The owner is the team, never an ordinary member row. */
  CREATE TRIGGER team_members_reject_owner
  BEFORE INSERT ON team_members
  WHEN NEW.user_id = (SELECT owner_id FROM teams WHERE id = NEW.team_id)
  BEGIN
    SELECT RAISE(ABORT, 'owner_cannot_be_member');
  END;
  `,

  /* 8 — which projects have a copy in the cloud, and when it was written */ `
  /*
   * One row per local project that has a cloud copy. cloud_project_id is not
   * unique on purpose: a project pulled back down is a second local project
   * pointing at the same copy, and saving either of them should update that
   * copy rather than quietly create another one.
   */
  CREATE TABLE cloud_saves (
    project_id         TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    cloud_project_id   TEXT NOT NULL,
    pushed_at          TEXT NOT NULL,
    document_count     INTEGER NOT NULL DEFAULT 0,
    presentation_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX cloud_saves_pushed_idx ON cloud_saves(pushed_at DESC);
  CREATE INDEX cloud_saves_cloud_idx ON cloud_saves(cloud_project_id);
  `
]

/** How many steps this build knows about; the database records how many ran. */
export const MIGRATION_COUNT = MIGRATIONS.length

export function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  const current = Number(row?.user_version ?? 0)

  for (let version = current; version < MIGRATIONS.length; version += 1) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version])
      db.exec(`PRAGMA user_version = ${version + 1}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}
