# INDRA LOADER

The desktop launcher: sign in against INDRA Auth, see the catalogue, download an
app, launch it. A separate application from INDRA HUB — separate identity,
separate installer, separate release train — that happens to live in the same
repository.

```
src/main/bootstrap.ts   decides which copy of the code runs, then loads it
src/main/index.ts       the app: window, IPC
src/main/lib/           identity, payload store, release selection, versions
src/main/services/      updates
src/renderer/           React + Tailwind UI
scripts/                sims: update pipeline, two-app isolation
```

## The update channel

A release publishes two things: the one-time Windows installer, and a small
`.asar` payload with a `payload.json` manifest beside it.

```
installed app.asar (v1.0.0)
   └── bootstrap.js ──► %APPDATA%\INDRA LOADER\update\state.json
                          ├── verified payload → run payloads/main/index.js
                          └── nothing/broken  → run the installed copy
```

An installed copy downloads the payload (a few MB, not ~120 MB), verifies its
SHA-256, and applies it on the next start. **No installer ever runs again.**

Four rules make it safe to ship:

| Rule | Why |
|---|---|
| Tag prefix `loader-v` | The hub tags `v<version>` from the same repo; `releases/latest` would hand the loader the hub's payload |
| Payload is never adopted unless hash **and** size match | A half-written download can never boot |
| Never a downgrade | A re-published old release cannot roll a user back |
| Two failed starts and the payload is dropped | Worst case is "the update did not take", never "the app will not open" |

## Commands

```bash
npm install
npm run dev            # window + hot reload
npm run typecheck
npm run build          # out/main (incl. bootstrap.js), out/preload, out/renderer
npm run sim:update     # release selection + payload adoption, no network
npm run sim:isolation  # this app and INDRA HUB share no identity value
npm run dist           # Windows installer (CI does this for real)
```

## Releasing

```bash
# 1. set the version in package.json
# 2. commit, then:
git tag loader-v1.0.1 && git push origin loader-v1.0.1
```

`.github/workflows/loader-release.yml` refuses a tag that disagrees with
`package.json`, runs typecheck + build + both sims, packages the installer,
packs and verifies the payload, and publishes the release. A manual run without
a tag builds the same installer as a downloadable run artifact and publishes
nothing.

## What is not here yet

The catalogue, the auth client, the download and launch engines, the admin API
and panel. Stage 0 is the shell, the identity and the update channel — the part
that has to be right before the first person installs anything.
