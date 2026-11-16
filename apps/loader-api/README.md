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
| `loader-files` | a public bucket, 300 MB per file |

The tables are `loader_*` on purpose: every other table in that project is `indra_*`
and belongs to the hub. Two applications, one database, one bill, one backup — and a
prefix that keeps them from ever reading each other's rows.

Nothing else needs to be run. `supabase/loader.sql` is the same schema kept in the
repository, so a second deployment can be rebuilt from nothing.

### Capacity, honestly

Supabase Storage gives **1 GB of storage and 5 GB of egress a month** on the free plan.
This catalogue is about 200 MB of installers plus a 14 MB backdrop film, and every visit
pulls a few megabytes of artwork — so the free plan is a countdown, not a home.

Backblaze B2 gives **10 GB of storage and 1 GB of downloads a day**, free, with no card.
That is several times the headroom, and it is where this deployment is meant to live:

| | storage | egress | per-file ceiling |
|---|---|---|---|
| Supabase free | 1 GB | 5 GB / month | 50 MB (raised here to 300) |
| **Backblaze B2** | **10 GB** | **1 GB / day** | none (5 GB single upload) |
| Cloudflare R2 | 10 GB | **unmetered** | none (5 GB single PUT) |

R2 is the better ceiling and the worse paperwork: its public address is a domain you have
to arrange before media can be handed out at the edge. B2's is arithmetic — the region
gives the host. Both are supported by `storage.ts`; `STORAGE_DRIVER` decides.

### Moving the bucket to B2

Three steps, none of them code.

**1. The bucket.** Backblaze → *My Account → Buckets → Create a Bucket*. Name it
(`indra-files`), pick a region close to the people downloading, and **set it to Public** —
artwork is handed out from `f004.backblazeb2.com` and a private bucket answers 401 there.
Then *Application Keys → Add a New Application Key*, limited to that bucket, with read and
write. It shows the key and the secret **once**.

**2. The move.** Add these in GitHub → *Settings → Secrets and variables → Actions*:

```
SUPABASE_URL                 https://cztyznuoferktewdhyji.supabase.co
SUPABASE_SERVICE_ROLE_KEY    Supabase → Project settings → API → service_role
B2_KEY_ID                    from the application key
B2_APPLICATION_KEY           from the application key
B2_BUCKET                    indra-files
B2_REGION                    us-west-004        (whatever the bucket says)
B2_PUBLIC_URL                optional, only if a Cloudflare domain sits in front
```

Then run the **storage** workflow. It starts as a dry run and prints every object, its
size and every row whose address would move; run it again with `apply` on and it copies
the bytes, rewrites the artwork addresses in `loader_apps.image_url` and `loader_config`
to the bucket's public host, points `loader_apps.exe_url` at the API (an installer stays
behind `/api/files/…`, where it is hashed and counted), and finally fetches the media back
from the public host to prove it answers. It leaves the Supabase copies alone, so nothing
is lost if you change your mind.

**3. The switch.** On Render, set the same five `B2_*` values (plus `STORAGE_DRIVER=b2`)
and redeploy. From then on uploads land on B2 and reads come from whichever driver is
active. Rollback is `STORAGE_DRIVER=supabase` and an undeploy — the old files are still
there.

Only new objects are affected by the driver, so the migration has to run *before* the
switch, not after: it is what moves the existing ones.

### What is public, and why

`images/` and `videos/` are handed out as the bucket's own public URL, because a card
preview and a backdrop film are the picture in the window and the storage provider's edge
serves them far better than this service can — cached, resumable, at the visitor's edge
instead of at a free instance that may be asleep. Installers are **not** media: an `exes/`
key is still streamed by `/api/files/…`, where it can be gated, hashed and counted, and a
stale media row that still points at `/api/files/…` gets a 302 to the public address.

### The film

The backdrop is the biggest thing a first visit downloads — 13.8 MB at 1080p. The
**slim-media** workflow re-encodes it in place (no audio, 24 fps, CRF 30), reports the
before and after, and replaces the object under the same key, so nothing needs repointing.
It needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and nothing else. Run it with
`apply` off first; a loop behind a dim overlay loses nothing at a tenth of the size.

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
