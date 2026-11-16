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

## Where it is deployed

**Vercel**, project `indra-site`, live at <https://indra-site-indra-df9b.vercel.app>.

The panel's `website` setting points at it, so the loader and the site agree about where
"the website" is.

### How it is deployed, and why it is odd

Vercel refuses to be handed a Git repository until a Git login connection exists on the
account, and this account has none — so the project is a **file upload** whose only file
is `bootstrap.mjs`. At build time that script writes the project's config, then reads the
site out of this repository (`apps/site`, branch `main`) and builds it.

The practical consequences:

| | |
| --- | --- |
| a deploy always builds the latest `main` | the upload is only a launcher |
| there is no push webhook | after a push, redeploy — from the Vercel dashboard, or ask me |
| nothing to keep in sync | the repository stays the single source of truth |

The day the repository is connected to Vercel properly: delete the project, import the
repository, set **root directory `apps/site`**, and drop `bootstrap.mjs`. Nothing in this
folder changes.

**Render is not needed.** `render.yaml` at the repository root only defines the panel now.

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
| `SITE_URL` | the Vercel URL | this site's own address, for canonical links and the sitemap |
| `INDRA_SITE_DEMO` | unset | `1` fills an empty catalogue with stand-in products, for design work only |
