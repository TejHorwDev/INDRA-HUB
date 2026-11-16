# INDRA — the public site

The page you send people to. It answers three questions in order: what is this, what is
published right now, and where do I get it.

It is **not** a second backend. Everything it shows comes from the panel that already
exists:

| it reads | from | what for |
| --- | --- | --- |
| the catalogue | `GET /api/loader/apps` | products, artwork, versions, which are live |
| the settings | `GET /api/loader/config` | the film behind the hero, its dim and blur, the notice, the published website |
| the release | `GET /api/loader/update` | the current loader version |
| the download | `GET /api/loader/installer` | the installer itself, streamed with Range |
| the download, checked | `GET /api/loader/installer?probe=1` | the version, name and true size of the file the button hands over |

**How live it is.** Every read is cached for ten seconds, and every page revalidates on the
same clock. Lock a product in the panel and it is locked here — dimmed, glyph, the word
Locked — within ten seconds. Upload a new clip to a product and that clip is what plays.
Ship 1.0.53 and the site says 1.0.53. No deploy, no cache to clear, nothing to keep in
sync. The one limit is the panel's own API: on a free tier that sleeps, the first request
after it wakes is slow, and no amount of caching on this side changes that.

The download is always the newest build: the button points at
`GET /api/loader/installer`, which resolves the latest release on every request, and the
address carries the version (`?v=1.0.52`) so a cached response can only ever be the build it
was named after.

**The number under the button is the file, not a guess.** The update feed describes the
*payload* — the 400 KB `.asar` an installed loader swaps in when it updates itself — and
printing that next to a 116 MB installer was how this site came to advertise a fake
download. So the version, the filename and the size all come from `?probe=1`, which resolves
the release exactly the way a click does and asks GitHub for the first byte of the real
asset. If that check fails, the page prints no size at all rather than a wrong one. The probe
runs on the same ten-second clock, which also keeps the panel's release lookup warm, so the
click does not land on a cold resolver.

Add a product in the panel and it appears here within ten seconds. Nothing on this site
has to be edited to publish anything.

## The pages

| route | what it is |
| --- | --- |
| `/` | the front page: the library shelf of clips, three steps, the download |
| `/p/<slug>` | one product — its clip, its live build, the loader link |
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

**One setting there is not in this repository.** The project has Deployment Protection set to
Vercel Authentication with `all_except_custom_domains`, which puts a Vercel login in front of
every `*.vercel.app` address — including the production alias. Anyone who is not signed in to
the team sees a login wall instead of the site, and an anonymous `curl` of the alias answers
with Vercel's SSO screen. Turn it off in **Settings → Deployment Protection → Vercel
Authentication**, or serve the site from a custom domain (custom domains are exempt). The
connector used to deploy this project cannot change that setting.

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

## Artwork

Whatever the panel published is what the card shows, and the URL is the only thing that
decides which: a `.webm`/`.mp4` is a looping `<video>`, a `.png`/`.jpg`/`.webp` is an `<img>`.
Both fade in over the name plate, and an artwork that cannot be read leaves the plate in
place rather than a broken-media glyph.

The backdrop behind the hero is the panel's own film (`videos/…` in the settings), with the
panel's dim as an overlay and its blur applied only when it is not zero. Its `<video>` carries
`autoplay`, `muted` and `loop` as attributes rather than as React props, so it starts while
the page is still hydrating — a backdrop that waits for JavaScript has already missed the
moment it was there for.

## Video

Product artwork is published as `.webm`/`.mp4`, so the shelf is video. `<Media>` decides
when a clip is worth decoding: it starts as it approaches the viewport, pauses the moment
it leaves, and stops when the tab is hidden. Clips are never scaled or filtered while they
play — that re-samples every frame — and each gets its own compositor layer so a playing
card does not repaint its border and scrim sixty times a second.

## Where the design lives

`src/app/globals.css`, one file, and it is a copy of the loader's design system:
`apps/loader/src/renderer/src/index.css`. Same tokens — `#070708` matte black, `#0c0c0f`
surfaces, `rgba(255,255,255,0.065)` hairlines, `--lift` and `--sheen` on every panel, the
white-to-`#cfcfd4` gradient wordmark, `cubic-bezier(.22,.61,.36,1)`. Same silk backdrop:
four off-centre washes and a fixed grain. Same card: the artwork *is* the card, the name on
it over a bottom scrim, one small state line under the name, nothing else.

If the app's look changes, this file should change with it — they are meant to be the same
object at two distances.

## Env

| name | default | meaning |
| --- | --- | --- |
| `INDRA_API` | `https://indra-loader-api.onrender.com` | which panel to read |
| `SITE_URL` | the Vercel URL | this site's own address, for canonical links and the sitemap |
| `INDRA_SITE_DEMO` | unset | `1` fills an empty catalogue with stand-in products, for design work only |
