# Connecting INDRA HUB to Supabase

The app is local-first today: SQLite lives in `%APPDATA%\indra-hub\indra-hub.db`
and the main process owns it. Adding Supabase is a staged job, and this file
tracks where we are.

---

## Stage 1 — the database exists (this document)

1. Create a project at <https://supabase.com>.
2. Open **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](../supabase/schema.sql), press **Run**.
3. Copy two values from **Project Settings → API**:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon / public key** — the long one labelled `anon`
4. Put them into the app: **Settings → Backend**, then press **Save and test**.

A successful test says *"Connected — the schema is in place."* If the tables are
missing it says so explicitly, which means step 2 did not run against that
project.

### What the test does

It calls the project's REST root with the public key, then asks for one row of
`indra_projects`. An empty result is normal: Row Level Security is on and no
policies exist yet, so the key can read nothing. That is the point.

### The rule that must never be broken

| Key | Safe in the app? | Why |
|---|---|---|
| `anon` / `public` | **Yes** | Every permission is decided by RLS policies in the database. |
| `service_role` | **Never** | It bypasses RLS entirely. Anyone who unpacks the installer would own your whole database. |

The app refuses to store a `service_role` key, and says why.

The public key is still not left lying around: it is encrypted with the operating system keystore
(DPAPI on Windows, Keychain on macOS, libsecret on Linux) before it is written to the local
database, and the interface only ever shows its last four characters. *Settings → Backend* marks a
sealed key with a small `sealed` badge; if the OS cannot provide a keystore, the app stores the
value unsealed and says so rather than pretending.

### Why RLS is the whole lock

Worth knowing before Stage 2: Supabase grants `SELECT` and `INSERT` on new
`public` tables to `anon` and `authenticated` **by default**. So the tables are
sealed by the *absence of policies*, not by the absence of privileges — RLS with
zero policies matches zero rows, which is why the key reads nothing and writes
nothing.

The practical consequence is that every policy added in Stage 2 is a real, open
door, and it opens for anyone holding the public key. When policies arrive:

- Write them narrow (`auth.uid() = owner_id`, not `using (true)`).
- Once per-user policies exist, `revoke all on public.indra_* from anon` is a
  cheap second lock — but do it *after* the app's connection test has moved to
  an authenticated read, otherwise the test turns into a permission error.

---

## Stage 2 — accounts in Postgres (database done, app pending)

`supabase/auth.sql` is applied. Identities are Google accounts held by Supabase Auth; the app never
sees or stores a password.

### What the database now does

| | |
|---|---|
| **Member numbers** | `IH-<year>-<running total>`, e.g. `IH-2026-000001`. Minted **once**, by the database, when the account is created — not derived from a login date, which would change daily and be worthless as an identifier. |
| **Profile on sign-up** | A trigger on `auth.users` creates the matching `indra_users` row (handle from the address, name from Google). It can never block a sign-in: a failure is logged and `indra_ensure_profile()` repairs it on first launch. |
| **23 RLS policies** | Every table is readable only by the people on that project. Writes are narrower still: only an owner changes membership or deletes a project. |
| **Column grants** | A policy says which *rows* you may write; the grants say which *columns*. `role`, `member_no` and `auth_user_id` cannot be written by a client at all. |
| **Team lookups** | `indra_find_member(query)` and `indra_project_roster(project_id)` return the picker fields and **never an email address**. |
| **Administrator** | `indra_claim_admin()` — the first signed-in person takes it, everyone after gets `false`. No default credential exists. |

### What was proven, not assumed

Run against the live project, in transactions that were rolled back afterwards:

- an `authenticated` session with an unknown id reads **0** rows from all seven tables
- `anon` reads **0** rows from all seven tables
- the owner of a probe project saw exactly **1** project and **1** document — its own
- a second signed-in user saw **0** projects, **0** documents, and could not read the other user's
  document **even by id**
- that user adding themselves to the project → `new row violates row-level security policy`
- a user promoting themselves to `admin` → `permission denied for table indra_users`
- a new `auth.users` row produced `IH-2026-000001` through the trigger

### What is still missing

1. **A Google OAuth client.** Create one in Google Cloud Console (OAuth consent screen → Credentials
   → OAuth client ID → *Desktop app*), then paste the client id and secret into Supabase
   *Authentication → Providers → Google*, and enable the provider. Until this exists, no Google
   sign-in can succeed.
2. **The app side.** Browser + loopback callback (PKCE), encrypted refresh-token storage, and the
   cloud data layer. Google blocks OAuth inside embedded webviews, so the sign-in opens the real
   browser and returns to `http://127.0.0.1:<port>`.
3. **Activation keys.** With sign-up going through Google, the key must be checked by an Edge
   Function holding the `service_role` secret — never by the app.

### Decisions taken

- **Offline-first.** A cached session keeps the app usable without a connection; SQLite stays as the
  local cache and outbox, and Postgres becomes the source of truth.
- **Member number at sign-up**, not at login.
- **Existing local accounts cannot be migrated** — scrypt hashes do not become Google identities,
  and an address that was never verified cannot be trusted. Data can be attached to the first
  Google account that claims it; the accounts themselves start fresh.

---

## Stage 3 — live sync (not started)

Two-way sync between the local SQLite copy and Postgres, with conflict rules.
The local database stays the working copy, so the app keeps working offline and
nothing becomes slower when the connection drops.

Per-table policies arrive here: a user reads and writes only projects they own
or belong to. That is when the sealed tables from Stage 1 open up.

---

## Why not "Supabase only"?

It is the shortest path to a backend, and the wrong one for a desktop
workspace: every document open, every autosave and every keystroke-triggered
save would become a network round trip, and the app would stop working on a
plane, in a basement, or when Supabase has an incident. Stage 3 gets the same
sharing without giving that up.
