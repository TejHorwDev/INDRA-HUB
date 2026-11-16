# INDRA

One repository, one clone, every INDRA project.

```
apps/
  desktop/   the INDRA HUB desktop app — Electron, React, SQLite, Supabase
  website/   the public site (next)
```

## The desktop app

```
cd apps/desktop
npm install
npm run dev        # development window
npm run build      # compile main, preload and renderer
npm run typecheck  # the same check the release build refuses to skip
npm run sim:installer
```

A Windows release is a tag:

```
cd apps/desktop
npm version patch --no-git-tag-version
git commit -am "…"
git tag v<version>
git push origin main --tags
```

`.github/workflows/release.yml` builds the stock installer, the in-app update
payload and the custom install window, then publishes all of them to the
release named after `package.json`'s version. It reads `apps/desktop`, so the
paths in that workflow are the ones to change if the app ever moves again.

## What lives on the server

Accounts, projects, documents, presentations, the shared workspace row, the
sign-in background video, portraits and administrator rights are all in
Supabase — one project, one truth, the same answer on every PC. The only thing
kept on a machine is the offline workspace, which is deliberate.

The Supabase project is not configured from this repository: the publishable
key and URL are compiled into `apps/desktop/src/shared/workspace.ts`, and no
service key exists anywhere in the app. Schema, RLS and RPCs are in
`apps/desktop/supabase/`.
