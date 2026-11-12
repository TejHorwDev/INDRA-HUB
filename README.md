# INDRA HUB

A local-first desktop workspace for writing documents and turning them into presentations, with
accounts, team projects, an administration panel and a deterministic offline converter.

## What's included

- **Accounts** — local registration and sign-in, scrypt password hashing, remembered sessions,
  login throttling, self-service profile, password change and account deletion.
- **Projects and teams** — owner/member model, member search, per-project access checks.
- **Document Studio** — block editor (headings, rich text, lists, quotes, code, tables, images,
  dividers), autosave, version history with restore, word/character counts.
- **Presentation Studio** — blank decks or one-click conversion from a document, slide editing,
  reordering, six themes, stale-source detection.
- **Project Intelligence** — a real data graph of the project's people, documents and decks.
- **Administration** — separate administrator identity with its own session, account
  suspension/restore/password reset/deletion, project rename/transfer/delete, content deletion,
  app-wide controls (maintenance mode, registration, activation keys), activity log and system
  information.
- **Activation keys** — optional local keys that gate registration. Single-use, expiring and
  revocable; only a SHA-256 digest is stored, and each code is shown once when generated.
- **AI provider** — not connected. Document conversion runs locally and consumes no credits.

## Stack

Electron 45, React 19, TypeScript, electron-vite, Tailwind CSS 4, and SQLite through Node's built-in
`node:sqlite`. The main process owns the database; the renderer reaches it only through typed IPC.

## Requirements

Node.js 20 or newer (the bundled Electron runtime provides `node:sqlite`).

## Development

```bash
npm install
npm run dev        # launch the app
npm run typecheck  # type-check main and renderer
npm run build      # production build into out/
```

## Data

The database is a local SQLite file in the app's user-data folder:

- Windows: `%APPDATA%\indra-hub\indra-hub.db`
- macOS: `~/Library/Application Support/indra-hub/indra-hub.db`
- Linux: `~/.config/indra-hub/indra-hub.db`

Schema migrations run automatically on launch.

## First administrator

Open **Settings → Administration** (or `#/admin`). On an installation with no administrator yet, the
setup screen asks for a Gmail address, a name and a password of at least 10 characters. Exactly one
administrator is created per installation; there are no default credentials and no way to create a
second one. Administrator sign-in is rate-limited and audited.

## Licensing

Activation keys are local. When the app moves to a hosted licensing service, the single
`consumeActivationKey` step in registration is where that provider is plugged in; accounts, sessions
and the rest of the app stay unchanged.
