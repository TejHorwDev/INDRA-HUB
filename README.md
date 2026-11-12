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

## Security model

The app treats everything it renders as hostile, because a document is a file that can be
shared.

- **Editor markup is allowlisted.** Document blocks are stored as HTML and rendered back with
  `innerHTML`, so every block passes through a tag and attribute allowlist
  (`src/main/lib/sanitize.ts`) on the way in *and* on the way out. Anything else — scripts, event
  handlers, `javascript:` URLs, iframes, inline styles — is discarded, including in documents
  written before the allowlist existed.
- **One instance.** A second launch focuses the first window instead of opening a second writer on
  the same SQLite file.
- **Links cannot hijack the window.** A link inside a document opens in the default browser; the
  app shell never navigates away from itself.
- **Stored keys are sealed.** The Supabase public key is encrypted with the operating system
  keystore (DPAPI / Keychain / libsecret) rather than left as text in the database, and it is never
  sent back to the renderer — the interface only ever shows its last four characters.
- **Renderer isolation.** `sandbox`, `contextIsolation` and no `nodeIntegration`; the renderer
  reaches the database only through typed IPC, and the packaged app runs under a Content Security
  Policy.

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

## The administrator

Every installation ships with exactly one administrator, created on first launch:

| | |
| --- | --- |
| Email | `admintej@gmail.com` |
| Password | `AAaa1234@$` |

Nothing on the sign-in or registration screens mentions it. Signing in with that email and password
on the ordinary **Sign in** screen opens the administration panel — one screen, two identities, and
an admin session is created rather than a user session. The panel is also reachable directly with
**Ctrl+Alt+A** (Cmd+Alt+A on macOS) or at `#/admin`. A different email is refused, and five failures
on the administrator's address lock the gate for fifteen minutes; a wrong password on someone
else's address never counts against it.

The password is stored as a scrypt hash — the database never holds the plain text — but it does
travel inside the application files, so it is a starting credential, not a secret. Change it from
**Admin → Access & controls** before giving a copy of the app to anyone else; the administrator
email and password can be replaced there, and only there.

## Supabase (optional)

The app needs no server. If you want a cloud copy, the administrator area
(**Ctrl+Alt+A** → Backend) stores a Supabase project URL and its **public** key, then proves the
connection and tells you whether the schema has been applied. It is an administrator setting, not a
user preference: the panel does not exist outside the admin gate, and the main process refuses every
`backend:*` call without an admin session. The tables, the security model and the staged plan are in [docs/SUPABASE.md](docs/SUPABASE.md)
and [supabase/schema.sql](supabase/schema.sql).

The identity layer is applied too — [supabase/auth.sql](supabase/auth.sql) adds member numbers, Google
identities held by Supabase Auth, and 23 Row Level Security policies, so the database itself decides
who may read which row. The app is not wired to it yet: accounts and documents still live locally,
which means nothing is synced and nothing leaves the machine.

That ordering is deliberate. A desktop app holding a public key is only safe if the *database*
enforces the rules, so the rules had to exist and be proven before any client could use them. The
app refuses to store a `service_role` key at all.

The public key is not a secret and is safe to have in a client — Supabase expects it to be. What
protects the data is Row Level Security in the database, which is why the tables stay sealed until
sign-in is handled by Supabase. The key is additionally sealed with the OS keystore at rest.

## Updates

An installed build updates itself from its GitHub Releases page. It checks **as it starts**, again
when the window regains focus (at most hourly), and every four hours while it stays open. An update
takes effect on the next restart — from **Restart and update** in *Settings → Updates*, or whenever
the app is next started.

**No installer is downloaded and no downloaded executable is ever run.** Each release publishes a
*payload*: the compiled app packed as one `.asar`, about a megabyte, next to a manifest that names
it, its size and its SHA-256. The app downloads the payload, verifies the hash, and leaves it in the
user's data folder. On the next start, `out/main/bootstrap.js` — the entry point — runs that payload
instead of the copy that came with the installer, falling back to the installed copy if anything is
wrong with it:

| Situation | What happens |
|---|---|
| No payload | The installed code runs |
| Payload missing, wrong size or wrong hash | Discarded; the installed code runs |
| Payload older than the installed app | Ignored, so an update can never downgrade |
| Payload loads but the app never reaches ready, twice | Discarded automatically on the third start |
| Payload loads fine | It keeps running, and reports its own version |

The bootstrap therefore makes the worst case *"the update did not take"*, never *"the app will not
open"*. The Windows installer is still the way onto a machine, and still the file on the release
page — it is simply not part of updating any more.

Updating requires releases to be **publicly readable**: GitHub refuses anonymous requests for a
private repository, so a private repository would need a personal access token compiled into the
app.

The first release containing this mechanism has to be installed by hand; every release after it
arrives in the app as a payload.

## Recovery

Two things can go wrong that no interface should be able to fix by itself.

- **Forgotten administrator password.** Launch the app from a terminal or the Run dialog with
  `--reset-admin`:

  ```powershell
  & "$env:LOCALAPPDATA\Programs\indra-hub\INDRA HUB.exe" --reset-admin
  ```

  This removes the administrator identity on this installation and asks for a new one; the shipped
  account is deliberately not recreated behind a reset. Projects, documents, accounts and
  activation keys are untouched. It is deliberately not a button in the
  interface: recovering access requires control of the machine, which is the same bar as opening
  the database file.
- **A failed upgrade.** Before any schema migration runs, the database is copied to
  `backups/` beside it (five most recent kept). Copying one back restores the previous state.

## Licensing

Activation keys are local. When the app moves to a hosted licensing service, the single
`consumeActivationKey` step in registration is where that provider is plugged in; accounts, sessions
and the rest of the app stay unchanged.
