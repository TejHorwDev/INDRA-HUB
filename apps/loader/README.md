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
npm run sim:download   # atomic commit, resume, hash rejection, cancel
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

## Updates

The same shape as the hub, and for the same reason: a release publishes a
`payload.json` and a ~0.3 MB `.asar`, the app fetches the manifest three seconds
after launch, downloads what it finds, verifies size and SHA-256, and leaves it for
the bootstrap to load on the way up.

Then two ways of applying it:

- **Silently**, when it is safe — before the first screen has been left, once per
  run. Launch, and a moment later the app is current. A guard file records the
  restart it is about to do, so a payload that fails to load cannot become a restart
  loop: the next launch sees the claim, sees the old version, and stays quiet.
- **Offered**, when it is not — an update that arrives while somebody is using the
  app shows one pill at the bottom of the window instead of taking the app away.

`lib/autorestart.ts` is the whole decision, as a pure function, including every
reason it must refuse: a form with a password in it, the library, settings, after
the first minute, a second time in the same run, or in development.

## Downloads and launching

`lib/downloader.ts` is the whole of it, with no Electron in the file so it can be
proven against a real server: bytes go to `<name>.exe.part`, a partial file is
resumed with a Range request, the hash covers the entire file including what was
already on disk, and the rename to the final name is the commit. A cancelled or
corrupt download is therefore never mistaken for an installed application.

`services/installed.ts` records where each product went, so launching does not
need the network. `services/launch.ts` spawns it detached and never automatically.

## What is not here yet

The catalogue API and admin panel, so the library is honestly empty until
something is published. Everything below the UI — auth, device identity, updates,
downloads, launching — is real.
