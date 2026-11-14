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

## Setup

### 1. Database

In the Supabase project's SQL editor, run `supabase/loader.sql`. It creates `apps`
and `config`, enables RLS with no policy, and seeds the one link key. Safe to run
twice.

### 2. Bucket

Create a bucket — Cloudflare R2 is the recommendation because egress is free, which
matters when every customer downloads a 300 MB installer. B2 works identically and
is configured the same way. Supabase Storage is the fallback.

If you leave `PUBLIC_BASE_URL` empty, files are served through `/api/files/<key>`
and the bucket can stay private. That is the default and the safer one.

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
