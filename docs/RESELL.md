# Selling a copy

How to hand a loader to somebody else: their own apps, their own panel, their own site, and
nothing of yours visible in any of it.

The shape is **one deployment per customer**, running under accounts you control. That is
deliberate:

- **Nothing is shared.** Their catalogue lives in their own database. A bug cannot show them
  your products, and it cannot show you theirs.
- **You keep the switch.** The service is yours, so pausing it ends their access. No argument,
  no migration, no code.
- **It costs nothing extra.** Every piece — Supabase, Render, Vercel — has a free tier that
  fits one catalogue comfortably.
- **Updating is the same work as for you.** The code is this repository; their deployment
  pulls from it like yours does.

The alternative — one panel, separate logins, one database — only pays off at twenty
customers and up, and it concentrates the worst possible bug (one filter missing, and one
customer reads another's prices) into your only database. Not at three.

---

## Before you start

You need, per customer, **nothing new** except their answers:

| What | Value |
|---|---|
| Brand name | what goes on the loader, the site and their panel |
| Short mark | what fits in a corner (falls back to the name) |
| Tagline | one line under it (optional) |
| Website | their domain, when they have one |

And you need the three accounts you already have: Supabase, Render, Vercel.

---

## Step 1 — their database (5 minutes)

1. Supabase → **New project**. Name it after the customer. Same region as you
   (`ap-northeast-2` is fine for Nepal/India). Save the database password somewhere.
2. Open **SQL Editor** and paste the whole of
   [`apps/loader-api/supabase/loader.sql`](../apps/loader-api/supabase/loader.sql). Run it.
   It creates `loader_apps`, `loader_config`, and the row that holds the settings.
3. **Storage → New bucket** → name it `loader-files` → **Public** → 300 MB limit.
   Public matters: artwork is handed out from the bucket's own address, and a private bucket
   answers 401 to every card.
4. **Project settings → API**: copy the Project URL and the `service_role` key.

## Step 2 — their panel (5 minutes)

Render → **New → Web Service** → this repository.

| Setting | Value |
|---|---|
| Root directory | `apps/loader-api` |
| Build command | `npm install && npm run build` |
| Start command | `npm start` |
| Instance | Free |

Environment:

```
SUPABASE_URL              <their project URL>
SUPABASE_SERVICE_ROLE_KEY <their service_role key>
ADMIN_USERNAME            <you choose — give it to them, not to their users>
ADMIN_PASSWORD            <long, random, theirs>
ADMIN_SESSION_SECRET      <32+ random characters>
```

Deploy. Then open `https://<service>.onrender.com/admin` and sign in. That is their panel,
empty, with their own catalogue.

> **Free instances sleep.** `/api/health` woken every five minutes by any uptime monitor keeps
> it warm. Without one, the first visitor after an idle hour waits ~30 s. See
> [Keeping a free instance awake](../apps/loader-api/README.md#keeping-a-free-instance-awake).

## Step 3 — their site (5 minutes)

Vercel → **Add New → Project** → this repository → **Root directory: `apps/site`**.

Environment:

| Variable | Value |
|---|---|
| `INDRA_API` | their Render URL, e.g. `https://acme-loader-api.onrender.com` |
| `SITE_URL` | their site address, e.g. `https://acme-loader.vercel.app` |

Deploy. The site reads their panel and draws itself: their name, their apps, their film.

> The site shows whatever the panel publishes, ten seconds behind. Add an app in the panel and
> it appears on the site without a deploy.

## Step 4 — make it theirs, not yours (2 minutes)

In **their** panel:

- **Settings → Brand** — name, short mark, tagline. This changes the site's wordmark, page
  title, footer, and the panel's bar and login screen **immediately, with no deploy**. The
  loader's own splash and Settings screen carry the name the installer was *built* with — see
  Step 5.
- **Settings → Links** — their website, and a **Loader download link** (their MediaFire,
  pixeldrain, their CDN). Until they set one, the Download button streams the newest GitHub
  release of *this* repository, which is your build — so set it.
- **Settings → Sign-in video** — their film, uploaded or a pasted link.
- **Products** — their apps. Installer and artwork, uploaded or pasted as links.

Nothing here needs a deploy. Every change is live within ten seconds.

## Step 5 — their installer

The loader's API address is **baked in at build time** (`__LOADER_API__`), so their installer
must be built pointing at their panel. Two ways:

**Simple, one customer:** dispatch *Build INDRA LOADER release* on their behalf, with
`INDRA_LOADER_API` set to their Render URL, then rename the artifact. The build workflow
lives in `.github/workflows/loader-release.yml`.

**Proper, for several customers:** same workflow, with `api` and `brand` inputs, so the
artifact arrives named for them. Not wired yet — see *What is not built yet* below.

Either way, hand them the `.exe`, not a link to yours: their installer points at their panel,
and yours would point at yours.

## Step 6 — handover

Send the customer:

- their site address
- their panel address, and the admin username/password
- their installer
- one line explaining that everything on their site is managed from their panel

Keep for yourself, in one table:

| Customer | Panel | Site | Admin user | Started | Paid until |
|---|---|---|---|---|---|

### Keeping the keys

- **Never reuse a database, bucket or panel between two customers.** The whole design above
  is that they cannot see each other.
- **Rotate `ADMIN_PASSWORD` when a customer leaves**, and pause their Render service. A
  paused service serves nothing; an unpaused one with a leaked password serves everything.
- **Their service_role key is a master key** to their database. It belongs in Render's
  environment and nowhere else — not in the panel, not in a chat, not in a screenshot.

---

## What is not built yet

Two pieces make this faster once you are doing it repeatedly:

1. **Branded installer builds.** `loader-release.yml` takes `publish` today. Adding `api` and
   `brand` inputs turns "build for a customer" into one dispatch that produces
   `<Brand>-Setup-<version>.exe` pointing at their panel — and takes the last hardcoded
   INDRA strings out of the loader's shell.
2. **A setup checklist that runs itself.** Supabase, Render and Vercel all have APIs; a
   script could create the three services and print the handover message. Worth it at ten
   customers, noise at three.

Both are additive. Nothing above changes.

## What it costs

| | free tier | what it covers |
|---|---|---|
| Supabase | 1 GB storage, 5 GB egress/month | ~300 site visits or ~120 app installs |
| Render | 750 h/month, sleeps when idle | one panel, always available |
| Vercel | 100 GB bandwidth | the site, effectively unlimited at this size |
| B2 / R2 | 10 GB, free egress | optional, if their catalogue outgrows Supabase |

One customer on the free tiers costs **zero** and holds a real catalogue. The first thing
worth paying for is a domain, because `acme-loader.vercel.app` is the only part of the
handover that still looks improvised.
