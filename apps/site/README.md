# INDRA — the public site

The page you send people to. It answers three questions in order: what is this, what is
published right now, and where do I get it.

It is **not** a second backend. Everything it shows comes from the panel that already
exists:

| it reads | from | what for |
| --- | --- | --- |
| the catalogue | `GET /api/loader/apps` | products, artwork, versions, which are live |
| the settings | `GET /api/loader/config` | the film behind the hero, the published website |
| the release | `GET /api/loader/update` | the current loader version and its size |
| the download | `GET /api/loader/installer` | the installer itself, streamed with Range |

Add a product in the panel and it appears here within a minute. Change the film in the
panel and the hero changes. Nothing on this site has to be edited to publish anything.

## The pages

| route | what it is |
| --- | --- |
| `/` | the front page: hero film, the catalogue grid, three steps, the download |
| `/p/<slug>` | one product — its own artwork full bleed, its live build, the loader link |
| `/sitemap.xml`, `/robots.txt` | written from the catalogue, so a product is listed the moment it is published |

Product addresses are the name (`/p/streamer-max`), not the UUID in the panel. An older
link by id still works: it redirects to the readable one.

## Running it

```bash
cd apps/site
npm install
npm run dev          # http://localhost:5290
```

Without a reachable API it renders with an empty catalogue — which is the honest state and
still a complete page. To look at the design with products in it, use the stand-in
catalogue, which is only reachable when this variable is set:

```bash
INDRA_SITE_DEMO=1 npm run dev
```

## Deploying it (Render)

`render.yaml` at the repository root already defines the service:

```yaml
- type: web
  name: indra-site
  rootDir: apps/site
  buildCommand: npm install && npm run build
  startCommand: npm start
  healthCheckPath: /
```

Three ways, in order of how much they depend on your accounts:

1. **Public Git repository — no account connection needed.** If Render's GitHub connection
   is refusing to link, this is the way in: the repository is public, so Render can clone it
   with no login at all. New **Web Service** → *Public Git repository* →
   `https://github.com/TejHorwDev/INDRA-HUB` → branch `main` → **Root Directory** `apps/site`
   → runtime Node → build `npm install && npm run build` → start `npm start` → env
   `INDRA_API=https://indra-loader-api.onrender.com`, `SITE_URL=<the service's own URL>`.
   The one cost: without a linked Git account Render cannot auto-deploy, so a push is
   followed by **Manual Deploy → Deploy latest commit**.
2. **Blueprint** — point Render at the repository, apply `render.yaml`, and you get both
   services (`indra-loader-api` and `indra-site`) with auto-deploy.
3. **New Web Service, Git-connected** — same fields as (1), plus automatic deploys on push.

No secrets. Nothing to copy between services. The site is public read-only.

## Where the design lives

`src/app/globals.css`, one file, no framework. Matte black, dark grey, white; the layout
is a broadsheet — a narrow label column on the left, content hanging off it at full width,
and a headline that is the largest thing on the screen by a factor of two.

The hero film is the one the panel publishes, dimmed and softened to a texture; if no film
is set the hero is a plain matte field and nothing breaks.

## Env

| name | default | meaning |
| --- | --- | --- |
| `INDRA_API` | `https://indra-loader-api.onrender.com` | which panel to read |
| `SITE_URL` | `https://indra-site.onrender.com` | this site's own address, for canonical links and the sitemap |
| `INDRA_SITE_DEMO` | unset | `1` fills an empty catalogue with stand-in products, for design work only |
