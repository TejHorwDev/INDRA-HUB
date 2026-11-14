# INDRA HUB — full code review

**Reviewed:** branch `arena/cb4ffce4-indra-hub`, commit `d0713dc` (v2.9.3), clean tree.
**Scope:** Electron main process, IPC/preload boundary, SQLite layer, Supabase SQL + Edge Function, renderer, build/release pipeline.
**Method:** line-by-line reading of `src/main/**`, `src/preload/**`, `supabase/**`, `.github/workflows/**`, `installer/**`, plus targeted reading of the renderer and the shared types; `npm install` (lockfile unchanged), `npm run typecheck` on both projects, and every `scripts/*-sim.mjs`.

Nothing in the repository was modified. This file is the only addition.

---

## What was verified mechanically

| Check | Result |
| --- | --- |
| `tsc --noEmit -p tsconfig.node.json` | **passes**, no errors |
| `tsc --noEmit -p tsconfig.json` | **passes**, no errors |
| 17 simulation suites (`scripts/*-sim.mjs`) | **16 pass, 1 fails** — `npm run sim:workspace` |
| `package-lock.json` consistency | fine; `npm ci` in CI is safe |

`npm run sim:workspace` fails before it tests anything:

```
✗ Named export 'dialog' not found. The requested module 'electron' is a CommonJS module …
```

The sim builds the real `workspace.ts` with an Electron stub (`scripts/workspace-sim.mjs:302`) that exports only `{ app, BrowserWindow, safeStorage, net }`. `workspace.ts` imports `./cloud`, `cloud.ts` imports `./archive`, and `archive.ts:4` imports `{ BrowserWindow, dialog }`. The whole suite has therefore been dead since cloud push/pull started using archive code — and since **no workflow runs the sims at all** (`.github/workflows/release.yml:64-65` runs only `npm run typecheck`), nothing noticed. Every behavioural claim that rests on "the sims prove it" is currently unenforced.

---

## Severity 1 — fix before shipping

### 1. A working administrator password is committed to the repository
`src/main/services/admin.ts:63-64`

```ts
const BUILT_IN_ADMIN_EMAIL = 'admintej@gmail.com'
const BUILT_IN_ADMIN_PASSWORD = 'AAaa1234@$'
```

`ensureBuiltInAdmin()` seeds this account into every installation at startup, and `README.md:79-80` publishes both values. Anyone who has ever seen this repository — or downloaded the installer and read the README — can press `Ctrl+Alt+A`, sign in, and own the admin panel on any machine where the owner has not changed the password. The panel can change the workspace configuration, read the audit log, change the admin identity, and repoint the backend. The bootstrap should create an admin from a first-run prompt or a per-install random secret, never a constant.

### 2. `shell.openExternal` is called with an unvalidated URL
`src/main/index.ts:94-97`

```ts
mainWindow.webContents.setWindowOpenHandler(({ url }) => {
  void shell.openExternal(url)
  return { action: 'deny' }
})
```

The navigation guard immediately below (`:108-115`) correctly restricts to `^https?:`, but the window-open handler — the one that fires for every `target="_blank"` link — passes anything through. On Windows, handing `ms-msdt:`, `search-ms:`, `file:`, `smb:` or a registered custom scheme to the shell is a long-standing code-execution primitive. This is reachable from content the app does not control: AI citations are rendered as `<a href={source.url} target="_blank">` with no scheme check (`src/renderer/src/components/AiPanel.tsx:428-437`), and `source.url` comes straight from the model provider's grounding metadata. Sanitised document links are limited to `http/https/mailto/tel`, so those are safe; citations are not.

Fix: reject unless `/^https?:/i.test(url)` in the handler (and in `AiPanel`).

### 3. Cloud project invitations can be hijacked by claiming the address
`supabase/sharing.sql:30-39`, `:141-165`, `:199-201`

Invitations are addressed to `contact_email` and answered only if it matches the caller's `indra_my_contact_email()`. But `contact_email` is a column the user writes themselves:

```sql
grant update (username, display_name, contact_email) on public.indra_users to authenticated;
```

There is no verification, and the column is explicitly **not unique** (`:26-33`). So any signed-in account can set its `contact_email` to a victim's address and then:
* see the victim's pending invitations (`indra_my_invites()`, `:141`), which include project names and the inviter's name;
* call `indra_answer_invite()` on them and be inserted into `indra_project_members` — i.e. read/write every document in that project.

This defeats the file's own stated invariant ("only the account that owns that email can answer it"). Either verify the address out of band, make acceptance require a second signal (an invitation token delivered to the address, or the owner's confirmation), or bind invitations to a profile id chosen by the owner rather than to a self-asserted string.

### 4. Administrator status is "first caller wins", and it hands over the workspace
`supabase/auth.sql:461-481`, `supabase/credit-console-tools.sql:277-345`, `supabase/workspace-owner.sql:53-101`

`indra_claim_admin()` grants `role = 'admin'` to whichever authenticated account calls it first when no admin exists, and it is executable by every authenticated user. `indra_claim_credit_admin()` will promote any caller once the current holder has been idle for a day. `indra_claim_workspace_as_admin()` then hands the workspace row to any admin. The SQL comments justify this with "signup gated by an activation key", but no gate exists in these files (activation is enforced locally by `activation.ts` and can be turned off with `require_activation_key`, a column the workspace owner controls). On a public Supabase project, "first" is whoever registered. Treat the role as something seeded once by an operator credential, not as a land-grab.

### 5. AI balances can go negative, because the spending function is not atomic
`supabase/ai-credits.sql:259-306` + `supabase/functions/ai/index.ts:223-233`

`indra_spend_ai()` does read-then-write:

```sql
v_user := public.indra_ensure_credit_day(p_user);      -- read balance
if v_user.daily_tokens + v_user.purchased_tokens < p_cost then … end if;
update public.indra_users set daily_tokens = daily_tokens - v_daily … -- no guard, no lock
```

The Edge Function fans out searches with `Promise.all`, so three to six charges arrive concurrently against the same row. Each transaction reads the same pre-spend balance and each subtracts, so the account can be driven below zero and the owner pays for tokens nobody was charged for. Use `select … for update` or a single conditional `update … where daily_tokens + purchased_tokens >= $1 returning *`, and retry on zero rows.

### 6. One failed search throws away a whole research run the user already paid for
`supabase/functions/ai/index.ts:223-233` vs `:305-316`

The primary searches have no per-call guard:

```ts
const searches = await Promise.all(questions.map((q, i) => timed(`search:${i+1}`, () => turn({...}))))
```

`timed()` charges each successful turn as it lands. If any one of them fails (provider 5xx, timeout), `Promise.all` rejects, control jumps to the outer `catch`, and the response is `502 provider_error` — after the plan call and the successful searches have been billed. The follow-up batch two hundred lines later does add `.catch(() => null)`. Wrap the primary batch the same way (and consider `Promise.allSettled` for every batch), so a partial run still produces a brief from what did come back.

---

## Severity 2 — real defects, wrong behaviour visible to users

### 7. Every local push deletes the cloud copy first, then re-inserts it — and wipes cloud-only work
`src/main/services/cloud.ts:895-975`

`pushProject()` issues a `DELETE` on `indra_documents` for the whole project and then `POST`s the local rows; the same for `indra_presentations` and slides. There is no transaction (there cannot be, across separate PostgREST calls), so:
* a failure between the two calls leaves the cloud project **empty**;
* `indra_document_versions` cascades, so the cloud's version history is destroyed on every push (the comment at `:918` presents this as a feature — keeping the copy "exactly as large as the local one");
* any document that exists in the cloud because another member created it, or because a member edited it, is deleted and replaced by the pushing machine's local state. Given that `sharing.ts` lets members write to the same cloud project, the last push wins over everyone else's work.

Use `on_conflict` upserts plus a diff (delete only ids absent locally *and* owned by this profile), or move the whole operation into a `security definer` RPC that runs in one transaction.

### 8. Cloud items are matched by **title** when pulling
`src/main/services/cloud.ts:1205-1221` (and the same pattern in `sharing.ts`)

```ts
const index = localDocs.findIndex((row) => row.title === cloudDoc.title)
```

Two documents with the same title (trivially producible: "Untitled" twice, or a duplicated document) are silently mis-mapped on pull, so edits land on the wrong local row and `cloud_items` records the wrong `cloud_id`. Documents have stable cloud ids (`cloudDocumentId(projectId, localId)`) — match on those instead.

### 9. The optimistic-concurrency `force` flag is never cleared
`src/main/services/cloud.ts:996-1001`, `:1206-1211`; `src/main/services/sharing.ts:660-665`, `:719-724`

Every upsert into `cloud_items` looks like:

```sql
ON CONFLICT(project_id, kind, local_id) DO UPDATE SET
  cloud_id = excluded.cloud_id, synced_at = excluded.synced_at, synced_hash = excluded.synced_hash
```

`force` is set to 1 by `resolveConflict(id, 'local')` (`sharing.ts:1249`) but never reset. Once a user resolves one conflict in favour of the local copy, **every later sync of that item skips the `updated_at=eq.…` guard** (`sharing.ts:1054`, `:1123`) and overwrites the remote row unconditionally — including changes made by other people afterwards. Add `force = 0` to the update branch.

### 10. Conflicts are decided by client clocks, which the module says cannot be trusted
`src/main/services/sharing.ts:1023`, `:1114`; `cloud.ts:924-931`

The module's own comment says two PCs do not share a clock, yet conflict detection is `iso(remote.updated_url) !== iso(map.synced_at)` and `pushProject` uploads the **local** `updated_at` values as the cloud rows' timestamps. A machine whose clock is behind can therefore push a "new" row that compares as older, or a machine whose clock is ahead can make every other copy look stale. Use the server's `now()` (a trigger, or `updated_at = now()` on upsert) as the comparison basis.

### 11. `DELETE FROM cloud_saves` is not scoped to the account
`src/main/services/cloud.ts:1336` (`adoptCloudKey`) and `:1352` (`forgetCloudIdentity`)

`cloud_saves` is keyed by project only, not by account. On a PC with two local accounts — the product explicitly supports several accounts and an offline profile — signing one account out of the cloud deletes the other account's cloud links too, turning their "saved to cloud" badges into dead ones and causing the next push to create a duplicate cloud project.

### 12. The cloud transfer code is a plaintext password in base64
`src/main/services/cloud.ts:1292-1296`

```ts
const payload = JSON.stringify({ v: 1, email: current.email, password: current.password })
return { code: `${KEY_PREFIX}${Buffer.from(payload, 'utf8').toString('base64url')}` }
```

Anyone who sees the string (screenshot, clipboard history, chat message, support log) recovers the generated Supabase account's password and can sign in as that identity from anywhere, forever — there is no expiry and no revocation short of changing the password. If the transfer code must exist, make it a short-lived, single-use server-side claim (a row the first use deletes), not a credential.

### 13. Stored identity falls back to plaintext when the OS keystore is unavailable
`src/main/lib/seal.ts:26`, `:30`

```ts
if (!canSeal()) return PLAIN_PREFIX + secret
…
catch { return PLAIN_PREFIX + secret }
```

`README.md:38-39` states stored keys are encrypted with DPAPI/Keychain/libsecret. On Linux without a keyring, in some Windows service/session contexts, and whenever `encryptString` throws, the Supabase password is written to SQLite in clear text. Combined with finding 12, an attacker with file access gets a working cloud credential. Prefer refusing to persist (and telling the user) over silently downgrading, or at least surface the downgrade in the UI.

### 14. `register` allows duplicate e-mail addresses; sign-in does not
`src/main/services/auth.ts:168` (`WHERE email = ?`) versus `:245` (`WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE`), and `:349` (`WHERE email = ? AND id <> ?`)

Registration's uniqueness check is case-sensitive; sign-in's lookup is case-insensitive with `LIMIT 1`. Registering `Tej@Example.com` and `tej@example.com` creates two accounts, and afterwards **both** people's sign-in attempts resolve to whichever row SQLite returns first: one of them cannot get in, and the other is shown the wrong account's display name and profile. `updateProfile` has the same hole, so an existing user can also set their address to a case variant of somebody else's. Normalise the column or use `COLLATE NOCASE` consistently (`normalizeEmail` already exists).

### 15. Presentation slides are not held to the document sanitiser
`src/main/services/presentations.ts:101-130` and `:152-158`

`sanitizeSlide()` bounds the strings but copies `image.src` verbatim (`raw.image.src.slice(0, 200_000)`) and `readSlides()` returns whatever JSON is stored. Documents apply `cleanImageSrc()` (`documents.ts:91`), which restricts to http(s)/safe data images. Consequences: a deck pushed from a cloud project can carry `file:///…` or arbitrary `data:` URLs into `<img src>`, and the editor/preview will attempt to load them. This is not script execution (the CSP and `<img>` semantics prevent that), but it is an inconsistent trust boundary and a local-file probing surface. Re-use `cleanImageSrc()` here.

### 16. The Supabase publishable key and the base-table grants expose more than the view
`supabase/workspace.sql:119-125`, `:235-265`

`indra_workspace_state` was created specifically to hide `claim_hash` and `owner_uid` ("It hides the claim hash, and answers 'is this row mine?'"). But the same file grants `select` on the *base table* to `anon`:

```sql
revoke all on public.indra_workspace from anon, authenticated;
grant select on public.indra_workspace to anon, authenticated;
```

The publishable key in every copy of the app therefore reads `claim_hash` (a SHA-256 of the setup code, attackable offline) and `owner_uid` directly from `/rest/v1/indra_workspace`. Revoke the base-table SELECT from `anon` and keep it on the view only.

### 17. Anyone with the publishable key can list and download every stored object
`supabase/workspace.sql:181-183`

```sql
create policy indra_media_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'indra-media');
```

The bucket is private (`public = false`) but this policy lets **anon** enumerate and download everything in it: the sign-in video, the developer portrait, and every member's `portraits/<uid>/…` image (`portraits.sql:123-153` writes those). If portraits are meant to be visible to workspace members, gate reads on `authenticated`; if they are public, say so. Either way, anon has no reason to read the bucket.

### 18. Updates are authenticated by a hash taken from the same unauthenticated file
`src/main/services/updates.ts` (`checkForUpdates`, `downloadPayload`) plus `.github/workflows/release.yml:107-113`

`payload.json` names a file, a size and a SHA-256; the app downloads both over HTTPS from the GitHub release and checks the hash. That proves the download matches the manifest and nothing more — the manifest itself is unsigned. Anyone who can publish to the release (a stolen `GITHUB_TOKEN`, a compromised maintainer account, a hijacked release) ships arbitrary code that runs as the user without an installer, because the payload is an `.asar` the bootstrap `require`s (`src/main/lib/payload.ts`). Add a signing key (e.g. minisign / Ed25519 over the manifest, public key compiled in) or verify the Authenticode signature of the built payload.

Secondary points in the same path: the download starts automatically on the first check with no consent, there is no size ceiling on the downloaded body, and installing a different version leaves the previous pending `.asar` on disk.

### 19. In-app AI is live and undocumented
`README.md:22` says "**AI provider** — not connected. Document conversion runs locally and consumes no credits." In fact `src/main/services/ai.ts`, the AI panel, `CreditsScreen`, the admin tokens console, `supabase/ai-credits.sql` and the deployed `supabase/functions/ai/index.ts` are all present and wired. Documentation that understates the attack surface (document text leaves the machine for a model provider) is worse than none: users are told their writing stays local.

Related, same file: `README.md:38-39` says the Supabase key is keystore-encrypted, while `src/shared/workspace.ts:16-21` compiles the URL and publishable key into the bundle in clear text (correctly — it is a public key — but not what the README says).

---

## Severity 3 — correctness and robustness

20. **`readSlides`/`writeSlides` trust a client-supplied primary key.** `presentations.ts:178-185` inserts the slide id the renderer supplied, only length-truncated. A colliding id throws `SQLITE_CONSTRAINT` mid-transaction instead of being regenerated; ids are also not scoped per presentation.
21. **`documents.ts` invents user ids.** `user()` returns `{ id: '', … }` (`documents.ts:44-47`), and `toSummary` falls back to `{ id: '', username: 'unknown' }` (`:56`). Anything keying on `createdBy.id` (the graph, member links, avatars) gets an empty string.
22. **`graph.ts` drops decks whose source document was deleted.** Only presentations with a `sourceDocumentId` that still exists are attached to the tree (`graph.ts:41-63`); decks with a `sourceDocumentId` pointing at a removed document appear nowhere — not under documents, not under orphans.
23. **`graph.ts` mixes member counts.** The root node reports `project.memberCount + 1` (`:131`) while `counts.members` reports `project.memberCount` (`:139`); whichever the roster computes, one of them is off by one.
24. **`convert.ts` claims determinism but is not.** The header says "the same document always produces the same deck" (`:8-9`), but `makeSlide` assigns `randomUUID()` ids (`:86`), so two conversions of the same document differ byte for byte and cannot be diffed or de-duplicated.
25. **`convert.ts` closing-slide logic can attach the wrong section.** `sawClosing` is set and never cleared; if a second closing-looking heading appears, `paragraphs` collected before it may be flushed as a `text` slide and then again contribute to the `closing` slide (`:293-301`).
26. **`sanitize.ts` truncates after sanitising.** `cleanHtml` does `sanitizeHtml(raw, OPTIONS).slice(0, maxLength)` (`:110`), which can cut in the middle of a tag or a `data:` URI and produce markup the browser re-parses differently from what was validated. Truncate first, or re-sanitise after slicing.
27. **`compareVersions` treats prereleases as final.** `1.0.0-beta` parses to `[1,0,0,0]` and compares equal to `1.0.0`; `1.1.0-beta` sorts *above* `1.0.0` and will be auto-adopted (`payload.ts:249-265`). Either implement semver precedence or refuse prerelease payloads explicitly.
28. **`errors.cloud()` / `errors.offline()` lose their code.** Both return `new AppError('UNKNOWN', message)` (`errors.ts:39-40`), so the renderer cannot distinguish "cloud unreachable" from "something broke", and `messageFor` falls back to the generic wording.
29. **Password hashing blocks the main process.** `scryptSync` (`password.ts:12`, `:18`) with default parameters runs synchronously on the Electron main thread for every sign-in, registration, password change and account deletion — tens to hundreds of milliseconds during which window messages, IPC and timers stall. Use the async `scrypt`, and cap password length before hashing.
30. **`searchUsers` returns e-mail addresses to any project owner.** `users.ts:94-121` maps `email` into the `UserSummary` for an exact-address search. That is also an existence oracle: an owner can confirm whether any address has an account on this machine by typing it. The UI only needs the match; return the minimum.
31. **`findAccountsByEmail` types a `LIMIT 1` result as an array.** `users.ts:73-87` declares `AccountRow[]` but can never return more than one row; callers written against "0 or 1" semantics are safe, callers written against "several" are not. Same pattern is worth a `?.` audit.
32. **Offline work adoption leaves dangling rows.** `claimOfflineWork()` moves `projects.owner_id` only (`offline.ts:114-130`). Any `project_members`, `team_members`, `invitations` or `cloud_items` rows that point at the offline profile id survive the move, so a claimed project can carry a member row for a profile nobody can sign in as. The comment argues such rows cannot exist; an owner can still invite the offline profile by address, and an imported archive can carry them.
33. **`archive.ts` casts instead of validating.** `parseArchive()` blind-casts to `ProjectArchive`, and `restoreArchive()` performs cleanup outside the transaction that inserts the project (`archive.ts`), so a malformed or hostile `.indra` file can create a half-restored project, and failed cleanup leaves orphaned media.
34. **Workspace push erases the shared background when the local machine has none.** `workspace.ts:735-739`: when `background` is falsy, the patch sends `background_asset_id = null`, `background_bytes = 0`, `background_path = null`. A second PC with no video installed, publishing an unrelated settings change (or the portrait), clears the video for everyone. Only send the nulls when a *removal* was requested on this machine (the portrait path already models this with `developerPhotoNeedsClear()`).
35. **The workspace sim cannot run (see top).** `scripts/workspace-sim.mjs:302` must export `dialog` (or the sim must stub only what `archive.ts` needs), otherwise the whole shared-workspace path is untested.
36. **No CI job runs the sims.** `.github/workflows/release.yml:64-65` typechecks and builds; 17 suites that encode most of the behavioural guarantees never execute in CI.

---

## Severity 4 — quality, consistency, small bugs

37. **`admin:workspace:claim-as-admin` skips the local admin guard.** `ipc/index.ts:1056-1058` uses `tokenAdmin()` while its sibling `admin:workspace:claim` (`:1060-1065`) calls `requireAdmin()`. The server-side RPC does check `role = 'admin'`, so this is defence-in-depth, not a bypass — but it is inconsistent, and it is the sort of thing that becomes a bypass when the server check is later relaxed.
38. **`cloud:key` calls `accountActor()` twice** (`ipc/index.ts:333-338`) — once to guard, once to use. Harmless today, an extra database read on every call.
39. **`tokens:state` ignores its argument.** `ipc/index.ts:1151-1153` accepts `payload.cached` and never uses it, so the "cached" path the renderer offers is a full round trip.
40. **`nativeTheme` listener per window, never removed.** `index.ts:121-125` adds a listener inside window creation; every re-created window (macOS `activate`) adds another, each capturing a `mainWindow` that may be destroyed.
41. **`splash.ts` leaves a timer dangling.** `:106` resolves after a 1500 ms `setTimeout` with no handle and no cancellation, so closing the splash early still runs the callback.
42. **`launch.ts` keeps the launch card alive across a restart** instead of dismissing it before `relaunch()`.
43. **`--reset-admin` / `admin:reset` can leave the app with no administrator.** `admin.ts:182-183` suppresses reseeding after an explicit reset, and `SEED_SUPPRESSED_KEY` is never cleared. The state is recoverable only through the first-run setup screen; if that screen is not reachable (e.g. the app thinks an admin exists), the panel is bricked.
44. **Admin identity is restricted to `@gmail.com`.** `setupAdmin`/`updateAdminIdentity` validate a Gmail address; the README and the UI both describe this as a "Gmail" login, but it is a policy with no technical basis and no way to use another provider.
45. **`admin.ts systemInfo()` interpolates table names into `count()`.** The names are fixed strings today, so it is not injectable; it is still a pattern that only works while the caller is trusted.
46. **`seal.ts`/`backend.ts`: the local admin can repoint the cloud endpoint.** `backend:save` accepts an arbitrary Supabase URL + key, and the app will then send the device identity (email + password) to it. Combined with the transfer code, a malicious admin (or a user tricked into pasting a config) exfiltrates cloud credentials. At minimum, warn and require the URL to be https and not a bare IP.
47. **`cloud.ts adminCloudSession()` returns `profile: ''`**, so `adminCloudRequest` can never address a profile row. Fine for the role RPCs it is used for, a trap for the next caller.
48. **`preload/index.ts` exposes nothing when `contextIsolated` is false**, and swallows the failure with `console.error`. The renderer then renders an app with no `window.indra` and no diagnostic. Fail loudly (or refuse to start).
49. **The AI prompts put up to 60 000 characters of document text on the wire per call** (`functions/ai/index.ts:41`, `MAX_INPUT_CHARS`), and `ai.ts ask()` stores the prompt text in local SQLite `ai_activity` in clear text. Both are reasonable product decisions, but neither is disclosed anywhere the user reads before using the feature (see finding 19).
50. **Edge Function `status` action is unauthenticated** (`functions/ai/index.ts:386-400`): it returns whether a key is configured, which variable supplied it, and the model names to anyone who can POST. Low risk, but it is an unauthenticated endpoint that describes the backend.
51. **CORS is `access-control-allow-origin: *` on the AI function.** The bearer token requirement keeps this from being exploitable, but it means any web page can probe for valid sessions at the network level if a token ever leaks into one.
52. **CSP is broad.** `script-src 'self'` is good, but `style-src 'unsafe-inline'` and `img-src … https:` allow inline styles and remote images (tracking pixels from any document or AI answer) in a renderer that otherwise has no network need. Consider `img-src 'self' data: blob:` and proxying remote images through the main process, as the portrait code already does.
53. **The installer is shipped before it has been run.** `installer.yml`'s own header says the custom installer "has never been run on Windows" and "must not be able to replace the download everyone else gets" — yet `release.yml:118-141` builds and attaches it to **every** release, and `installer.yml` duplicates the same build. It is named differently, so the updater ignores it, but it is still an unattended, untested executable distributed under the product's name.
54. **The installer workflow uses `npm install` for its own dependencies** (`installer.yml:66`, `release.yml:131`) where the root uses `npm ci`; `installer/` has no lockfile, so the shipped installer's dependency graph is unpinned.
55. **`installer/main.js` adds an IPC progress listener per call** (`installer/preload.js:21-24`) with no removal, and `setup:install` resolves on `exit` code 0 without checking that NSIS reported success another way; `installedExe` stays `null` if the install was a no-op, silently skipping the "open the app" step.
56. **Docs/code drift beyond AI.** `docs/PROJECT-BRIEF.txt` still lists `scripts/workspace-sim.mjs` as proof of the shared-workspace path (it cannot run), and describes Stage 3 person-level identity as future work while `auth.sql` already implements profiles, RLS and invitations.

---

## What I did not fully review

The main process, the SQL, the Edge Function, the preload bridge and the build pipeline were read in full. The renderer (~12 300 lines) was reviewed structurally (routing, session/connectivity/invitation providers, the AI panel, the document editor's save path) and by targeted search for injection and storage patterns, not line by line; `src/shared/types.ts` beyond the first ~120 lines and `src/renderer/src/styles/**` were not read. No runtime testing was done beyond the sims and the compiler, and I did not exercise the real Supabase project.

If you want the renderer audited to the same depth, or any of the Severity 1 items turned into patches, say which ones and I will start there.
