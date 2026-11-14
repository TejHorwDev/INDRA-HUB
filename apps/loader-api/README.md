# INDRA LOADER — API and admin panel

The backend for INDRA LOADER. A web panel you open in a browser, and the two public
endpoints the desktop app reads. Nothing here ships inside the app.

```
apps/loader-api/
  supabase/loader.sql   the schema — run once
  src/app/api/loader/   public: the catalogue and the one link
  src/app/api/admin/    the panel's API, every route session-guarded
  src/app/admin/        the panel itself, at /admin
  src/lib/storage.ts    R2 → B2 → Supabase → local, first configured wins
```

## Why it is shaped this way

**The panel is a website.** The desktop app contains no admin code and never talks
to an admin endpoint. A stolen installer gives nobody a catalogue to edit.

**Uploads never pass through the server.** The browser asks for a presigned URL and
PUTs the bytes straight to the bucket, so a 300 MB installer costs the API a few
kilobytes of JSON. The one exception is the local driver, which exists for
development.

**Hashes are computed where the bytes ended up.** After the upload the server
streams the stored object back, digests it, and writes the SHA-256 onto the product.
The loader then refuses to install a file whose bytes differ from that hash — which
only means something if the hash describes what is actually in the bucket.

**RLS is on with no policy.** The anon key can read nothing and write nothing.
Every read goes through this server, which holds the service role key.

## Where it lives

The database and the bucket are **already created**, in the same Supabase project as
INDRA HUB (`indra-hub`, ref `cztyznuoferktewdhyji`):

| Object | What it is |
|---|---|
| `loader_apps` | the catalogue, RLS on with no policy |
| `loader_config` | the one link, seeded empty |
| `loader-files` | a private bucket, 300 MB per file |

The tables are `loader_*` on purpose: every other table in that project is `indra_*`
and belongs to the hub. Two applications, one database, one bill, one backup — and a
prefix that keeps them from ever reading each other's rows.

Nothing else needs to be run. `supabase/loader.sql` is the same schema kept in the
repository, so a second deployment can be rebuilt from nothing.

### Capacity, honestly

Supabase Storage gives 1 GB on the free plan, which is about **eight** 116 MB
installers. That is enough to launch and not enough to grow. When the catalogue
starts filling up, either raise the plan or move to Cloudflare R2 — and moving is a
configuration change, not a code change:

```
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=...
```

The same rows keep working; only new uploads land somewhere else.

If you leave `PUBLIC_BASE_URL` empty, files are served through `/api/files/<key>`
and the bucket stays private. That is the default and the safer one.

## Deploying it

**Render** — the repository has a `render.yaml` at the root. New → Blueprint → pick
this repository → Render creates the service and asks for the three secrets once.
Wait for the build, then open `https://<service>.onrender.com/admin`.

**Vercel** — import the repository, set the root directory to `apps/loader-api`, and
add the same variables. The panel is a Next.js app with no build-time secrets, so it
builds first time.

**Anything else** — `npm install && npm run build && npm start`. The port comes from
`$PORT` and falls back to 3000; `npm run dev` uses 5280 locally.

A manual **Web Service** does the same job as the Blueprint without using it: same
root directory, same two commands, same variables. The `render.yaml` is a
convenience, not a requirement.

### 1. Environment

The only things missing are the three secrets, and they belong in the host's
environment rather than anywhere else: `SUPABASE_SERVICE_ROLE_KEY` (Supabase
dashboard → Project Settings → API), `ADMIN_PASSWORD`, and a generated
`ADMIN_SESSION_SECRET`.

If you set it, the bucket needs a CORS rule allowing `PUT` from the panel's origin:

```json
[
  {
    "AllowedOrigins": ["https://your-panel.example.com"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }
]
```

### 3. Environment

Copy `.env.example` and fill it in. Generate the session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`ADMIN_PASSWORD` is hashed in memory at boot and never stored anywhere.

### 4. Run

```bash
npm install
npm run dev      # http://localhost:5280/admin
```

Production:

```bash
npm run build
npm start
```

Deploys unchanged to Render (build `npm install && npm run build`, start
`npm start`), a container, a VPS, or Vercel. No build-time secrets are needed.

## Pointing the app at it

The loader reads `INDRA_LOADER_API` from its own environment at build time
(`apps/loader/src/main/services/catalog.ts`). Set it to this deployment's origin,
rebuild the loader, and the catalogue is live. Unset, the library is honestly
empty.

## What the app expects

```
GET /api/loader/apps    → { apps: [{ id, name, description, version,
                                     image, fileUrl, keyauthAppId,
                                     sha256, status }] }
GET /api/loader/config  → { website }
```

Both are public, read-only, and never return a 500: a database that is unreachable
answers with an empty catalogue, because the loader treats a failure and an empty
catalogue the same way and only one of them is loud.

## Keeping a free instance awake

`/api/health` answers `GET` and `HEAD` with a small JSON body and a 200, and it
touches the database on every call — which also stops a free Supabase project from
pausing for inactivity.

Point an uptime monitor (UptimeRobot's free plan is 5-minute intervals) at:

```
https://<your-service>.onrender.com/api/health
```

Five minutes is well inside Render's fifteen-minute idle window, so the service
never spins down. One monitor at that interval uses roughly 730 instance hours a
month against the free plan's 750 — it fits, with very little room to spare.

Use `?deep=1` if you would rather the monitor went red when the database is
unreachable; without it, a database problem is reported in the body rather than as a
failed check.

## Checking it

```bash
npm run lint   # types
npm run sim    # passwords, tokens, keys, and that every admin route is guarded
npm run build
```

`sim` exists because the mistakes that matter here are not type errors: a password
comparison a wrong guess can pass, a forged token, a key that reaches outside the
bucket, or an admin route that forgot its session check. All four are checked by
trying them.
