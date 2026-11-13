# Server-first migration — decisions and status

This is the working plan for turning INDRA HUB from "a local app with some cloud
extras" into a server-first app whose SQLite file is a cache and an outbox.

It exists because the original brief and the code disagreed in a few load-bearing
places. Those are settled here, once, with the reason, so the next step does not
have to rediscover them.

---

## Decisions taken

### 1. Ids stay `text`, derived from the local uuid

The brief proposes `indra_documents (id uuid …)`. The shipped schema uses
`id text`, and the client derives cloud ids deterministically
(`cloudDocumentId(projectId, localId)` → `"<project>:d:<local>"`), with
`cloud_items` mapping local rows to cloud rows.

Switching to `uuid` would need a mapping table, a rewrite of every id helper, and
a migration of every existing cloud row — and it would orphan `cloud_saves` and
`cloud_items` for every installation that has already pushed something. **The
existing tables are extended in place.** New columns are additive; no id is
re-keyed.

### 2. Offline means "a sealed session, read-only", not "a password on disk"

The brief asks for two things that cannot both be literal: *no password stored
locally* and *a cached session when the server is unreachable*. A refresh token
proves continuity, not identity; once it expires offline there is nothing left to
authenticate against.

So: **the session is a sealed refresh token; the password is never stored.**
Offline, the app opens with the last token while it is still valid, shows
"offline — changes will sync", and queues writes. When the token expires with no
connection, the app asks for a sign-in rather than silently degrading.

Legacy local accounts keep their local password hash until they are connected —
otherwise everyone who has been using the app would be locked out of their own
work by the update. That exception ends the moment an account is connected.

### 3. Existing cloud projects are re-owned in step 4, not silently orphaned

Projects already pushed belong to `device-*@device.indra.hub` profiles, and
`indra_projects.owner_id` is `on delete restrict`. There is no re-owner path
today. Step 4 adds one, run once per installation on first human sign-in, while
the sealed device identity is still present: transfer `owner_id` from the device
profile to the human profile, then delete the device identity. Until then,
existing cloud copies stay reachable through the device identity exactly as they
are now — nothing breaks, nothing is lost.

### 4. The migration is staged, and each stage keeps the app working

A fresh install must never be a new person *after* the migration, but flipping
the door before the mirror exists would lock people out. So:

1. **Accounts** (this change) — a human Supabase account, sealed session, local
   mirror, connection card. Additive: local sign-in still works.
2. **Pictures** — `cloud:` avatars rendered from the server with a disk cache.
3. **Content** — documents/decks server-first with revisions, tombstones, an
   outbox and realtime.
4. **Projects/teams** — server authority, membership, re-owning device projects.
5. **Admin/credits** — the console bound to the human admin role.
6. **Cleanup** — device identities for users, the manual "push" button, `photo:`
   for new pictures.

---

## Step 1 — what now exists

| File | What it does |
| --- | --- |
| `src/main/lib/supabase.ts` | one HTTP door (endpoint resolution, request, RPC, typed failures). Replaces the private copy in `cloud.ts`; `workspace.ts` still has its own and should move next. |
| `src/main/lib/accountSession.ts` | the sealed session: read/save/clear, refresh by token, `liveAccount()`, `accountStateFor()`. |
| `src/main/services/account.ts` | sign up, sign in, "connect the account on this PC", sign out; profile resolution; the local mirror. |
| `src/main/db/schema.ts` (migration 14) | `users.auth_user_id`, `cloud_profile_id`, `cloud_role`, `member_no`, `cloud_synced_at` + unique index. |
| `src/main/services/auth.ts` | `openSessionFor()` — the ordinary session, opened for an account authenticated elsewhere. |
| `src/main/services/cloud.ts` | `identity()` returns the human session when connected, so push/pull/share/portraits act as the person; `profileFor()` stops rewriting `contact_email` on that path. |
| `src/main/ipc/index.ts` | `account:state`, `account:sign-in`, `account:create`, `account:create-from-local`, `account:sign-out`. |
| `src/renderer/src/components/AccountCloudCard.tsx` | the visible card: connect this PC's account, or sign in to an existing one; shows member number, role, and whether the keystore sealed it. |
| `scripts/account-sim.mjs` | 30 checks against a fake Supabase: adoption, no password at rest, refresh by token, wrong password, offline refusal, sign-out, second PC. |

**No SQL change was needed for this step.** `public.indra_users` already has
`auth_user_id`, `username`, `display_name`, `member_no`, `role`, `suspended_at`,
`contact_email` and the portrait columns; `indra_ensure_profile()` and the
sign-up trigger already create the profile; the column grants already allow the
two fields the client writes. That is the one place the brief and the code
agreed.

### What the account does and does not control yet

It controls **who the cloud calls are made as**: `pushProject`, `pullProject`,
sharing, portrait publication and the credit/AI calls now carry the human's
access token instead of the machine's. So a project pushed from a connected PC is
owned by a person, and a second PC can act on it.

It does **not** yet: sync documents automatically, render portraits from the
server, or push profile edits (name, picture, password) to the server. Those are
steps 2–4. The account card says so rather than implying more.

### Verification, and its limits

Run and passing on this change: `npm run typecheck` (both projects),
`npm run build`, `npm run sim:account` (30 checks), and the existing suites —
`startup, launch, updater, admin, maintenance, appearance, team, collab, offline,
cloud, sharing, ai, function, about, credits, portrait`.

Not run, and not claimed: the Electron app itself (no display, no Windows), any
install/uninstall test, or a call against the live Supabase project. The live
project still needs the `#!/auth` settings checked by hand: **"Confirm email" must
be off** for sign-up to return a session, otherwise `createAccount` correctly
returns "confirm the address, then sign in" instead.

`npm run sim:workspace` remains broken for a reason unrelated to this change: its
Electron stub lacks `dialog` (so it cannot load), and with that added it runs 36
checks and then hangs waiting for a background video that its fake storage never
serves. Fixing it properly needs a working `net.fetch`/storage stub in that
harness — worth doing before step 3, because that is the sim meant to prove the
realtime and download paths.

---

## Next: step 2 (pictures from the server)

1. `users.avatar` accepts `cloud:<storage path>`; `PORTRAIT_PATTERN`
   (`src/main/services/portrait.ts`) and `src/shared/types.ts` both gate it, so
   both change together.
2. On portrait set: upload → `indra_set_my_portrait` → store `cloud:` locally.
   The existing `publishPortrait` already uploads and records; the change is that
   the *value* stored points at the result.
3. A byte-fetch IPC (`portrait:cloud-bytes`) with a disk cache under
   `<userData>/media-cache/<sha256>` keyed by path + `updated_at`.
4. Renderer falls back to initials, never a broken image, when the fetch fails.
5. Sim: offline render shows initials; cache hit makes no request; a changed
   `updated_at` refetches.

## Carried risks to fix alongside the later steps

- **Invitations key on a self-asserted `contact_email`** (`supabase/sharing.sql`).
  Once humans share projects this is an account-takeover path: anyone can claim
  an address and accept its invitations. Must be fixed in step 4, not after it.
- **`indra_spend_ai` is not atomic** and the Edge Function spends in parallel;
  balances can go negative. Fix with a conditional update before more people use
  the credits.
- **`shell.openExternal` accepts any scheme** (`src/main/index.ts`), reachable
  from AI citation links.
- Full list: `docs/CODE-REVIEW-2026-11-13.md`.
