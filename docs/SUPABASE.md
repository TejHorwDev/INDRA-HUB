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

## Stage 2 — real accounts (not started)

Supabase Auth replaces the local password table, with `auth_user_id` linking
`auth.users` to `indra_users`.

Two consequences to decide before this starts:

- Existing passwords are **scrypt** hashes in SQLite. They cannot be moved to
  Supabase Auth, so existing accounts either get migrated on first sign-in or
  are reset once.
- The app currently works with no internet at all. Sign-in would become an
  online action unless a cached session is designed in.

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
