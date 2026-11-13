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
4. Put them into the app: open the administrator area (**Ctrl+Alt+A**, or `#/admin`), choose
   **Backend**, then press **Save and test**. The panel is administrator-only by design — it is
   absent from Settings for ordinary users, and the main process rejects `backend:*` without an
   admin session.

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
database, and the interface only ever shows its last four characters. *Admin → Backend* marks a
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

## Stage 3 — sharing between PCs (shipped in 1.9.5)

Two-way sync between the local SQLite copy and Postgres, with conflict rules.
The local database stays the working copy, so the app keeps working offline and
nothing becomes slower when the connection drops.

Per-table policies arrived in Stage 2 and are what make this possible: a user
reads and writes only projects they own or belong to. What Stage 3 adds is the
door — `supabase/sharing.sql`:

- `indra_users.contact_email` — the address a person answers at (the identity's
  own address stays generated and private).
- `indra_project_invites` — one row per question, addressed to an address, with
  RLS on and **no policies**: the table is reachable only through the functions
  below, each of which checks the caller itself.
- `indra_invite_to_project` (owner only), `indra_my_invites` (matched on the
  caller's address), `indra_answer_invite` (only the addressed account, and the
  only thing that writes a membership), `indra_cancel_invite` (owner only),
  `indra_project_people`, `indra_my_projects`, `indra_project_invites_for`.

On the client, `src/main/services/cloud.ts` gains an identity per **account**
rather than per installation, and `src/main/services/sharing.ts` owns the rest:
bringing a shared project down with this PC's own ids, and an explicit sync that
pulls first, then pushes, guarded by the version each item replaced.

Conflict detection is content-based, not clock-based: every item stores a
SHA-256 of the version both sides last agreed on (`cloud_items.synced_hash`).
Two machines with different clocks therefore cannot make the whole project look
changed. An item changed on both sides is written to `cloud_conflicts` and left
alone until a person chooses "keep mine" or "take theirs".

Proven by `npm run sim:sharing` — two installations in one process, meeting only
through a stand-in for PostgREST that enforces these rules: invite, accept,
arrive, edit, send back, receive, conflict, resolve, and nothing sent while
offline. The SQL itself was exercised against the live project by creating
profiles, setting JWT claims and re-running the same steps under
`set role authenticated`.

---

## Why not "Supabase only"?

It is the shortest path to a backend, and the wrong one for a desktop
workspace: every document open, every autosave and every keystroke-triggered
save would become a network round trip, and the app would stop working on a
plane, in a basement, or when Supabase has an incident. Stage 3 gets the same
sharing without giving that up.

---

## Stage 2.5 — the shared workspace (shipped in 1.6.0)

Everything in the administrator panel that is machine-wide lives in **one row**
(`public.indra_workspace`, id `primary`) in this project:

| Column | What it controls |
| --- | --- |
| `allow_registration` | whether new accounts can be created |
| `maintenance` / `maintenance_message` | maintenance mode and what the screen says |
| `require_activation_key` | whether registration needs a key |
| `background_asset_id` / `_mime` / `_bytes` / `_path` | the sign-in video, in the `indra-media` bucket |
| `background_blur` / `_dim` | how that video is treated behind the form |
| `revision` | bumped by a trigger on every update; the tie-breaker for every client |

Every installation mirrors the row into its own SQLite database. The mirror is
what the app reads, so the sign-in screen, the maintenance screen and the IPC
guards work with no connection; the row catches up over a Realtime socket (or a
short poll) and each change is applied and broadcast to the open windows.

**When the row counts.** Only once it has an owner. An unclaimed row holds the
values the project shipped with — nobody can write it — so applying it would
undo whatever a machine's administrator has just configured. Until the claim,
each PC is the authority for its own settings (and for its own video); the
claim is the handover, and the claiming machine publishes everything it is
already running. (1.6.0 applied unclaimed rows anyway, which is why the first
video upload after that release disappeared within a minute.)

**Who may write.** Row Level Security allows `SELECT` for everyone (the row is
public configuration) and `UPDATE` only for the one account named in
`owner_uid`. The `anon` role has no `UPDATE` grant at all, so even a policy
mistake could not let a client write. Ownership is claimed once, with a setup
code whose SHA-256 is seeded into `claim_hash`; `indra_claim_workspace()` clears
it in the same statement that sets `owner_uid`, so the code is single-use.

**Where the endpoint comes from.** `WORKSPACE_URL` and `WORKSPACE_KEY` in
`src/shared/workspace.ts` are compiled into the build, which is why a fresh
install inherits the administrator's settings instead of defaults. The key is
the *publishable* one: it can read the row and nothing else. The secret /
`service_role` key is never in the app. An administrator can point a machine at
a different project in Admin → Cloud & sync, and "Disconnect" is remembered so
the built-in endpoint is not put back on the next launch.

**Applying it.** `supabase/workspace.sql` is the whole thing, idempotent, with
the setup-code instructions at the bottom. The project this app points at
already has it applied (migrations `workspace_settings_realtime` and
`workspace_public_view`).

**Proved.** `npm run sim:workspace` runs the shipped client against a faithful
fake of GoTrue, PostgREST, Storage and Realtime: a fresh install adopting the
row, a published change reaching a machine that never signed in, claiming,
publishing, a video travelling between machines, a stale write losing to the
newer row, hostile payloads clamped or refused, offline behaviour, and a
disconnect surviving a restart.

---

## AI and tokens

The balance is Postgres's, not the app's. Every account owns its own SQLite file,
so a number kept on the user's machine is a number the user can edit.

**What is deployed.** `supabase/ai-credits.sql` (run first) then
`supabase/credit-console.sql` create `indra_plans`, the two buckets on
`indra_users`, an append-only `indra_credit_ledger`, `indra_purchase_requests`,
and the functions that move a balance. `indra_spend_ai()` is granted to
`service_role` alone, so the app can read its own state and ask for a purchase
but cannot pay itself. `cron.schedule('indra-credit-daily-reset', '5 0 * * *',
'select public.indra_reset_all_daily();')` refills every allowance at 00:05 UTC;
`indra_admin_reset_daily()` does the same on demand from the admin console.

**Tiers.** Free, Basic and Pro ship as rows in `indra_plans` — daily allowance,
price and whether the tier is offered. All three are editable from Admin →
Tokens, including creating a fourth; nothing about a tier is compiled into the
app beyond the cached copy it draws while loading.

**The one thing that switches AI on.** The `indra-ai` Edge Function holds no key
and the app holds none either. The project secret `GEMINI_API_KEY` (or
`GOOGLE_API_KEY`) is what lets it call a model:

```
Supabase dashboard → Project Settings → Edge Functions → Secrets
GEMINI_API_KEY = <key from Google AI Studio>
```

Optional model overrides: `AI_CHAT_MODEL`, `AI_PLAN_MODEL`, `AI_SEARCH_MODEL`,
`AI_RESEARCH_MODEL`. Defaults are `gemini-2.5-flash` for chat, planning and
search, and `gemini-2.5-pro` for the deep brief.

Until that secret exists the function answers every run with `503
not_configured` **before** any balance is read or charged. That is a workspace
fact, not a user error, so the app asks instead of guessing:

```
POST /functions/v1/indra-ai   { "action": "status" }
→ { "configured": false, "keySource": null, "models": { … }, "research": true }
```

The research panel shows the same sentence to the person asking, and Admin →
Tokens shows it above the balances, naming the variable to add. Names are
reported; the key itself never leaves the function's environment.

**Research, in two passes.** A standard run plans three questions, searches each
with grounding, and writes a 500–800 word brief. Deep plans six, then runs a gap
turn over what came back — the opposing case, the number nobody quoted, what
changed this year — and reads up to three more pages before writing 900–1400
words. Every factual sentence carries `[n]` against the sources that were
actually returned; the URLs are shown before anything is inserted. The gap pass
is skipped near the time budget or when the balance runs out, and a failed gap
pass still leaves the first round standing.

**Charging.** The charge is the token count the provider reported, once per
provider call, through `indra_spend_ai()`. Nothing is estimated: if the provider
returns no usage, the run fails rather than inventing a number. A spent balance
stops the run mid-way and the response says which stage stopped it.

**Proved.** `npm run sim:credits` exercises the wire contract, the tier maths and
the ledger with a fake server; the app refuses to run while offline, and refuses
before building a request when the balance is empty.
