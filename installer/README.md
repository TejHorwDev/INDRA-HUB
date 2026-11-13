# The installer window

This folder is the installer people actually see: a frameless near-black window
with an optional film behind it, built as its own small Electron app.

It does not reimplement installing. `payload/inder-setup.exe` is the stock NSIS
installer produced by the main build; this window passes it `/S` plus the scope
the person chose, watches the install folder fill up so the progress bar is real,
and then launches the app. Shortcuts, the uninstall entry, per-user versus
per-machine folders and the updater stay NSIS's job — code that has been
installed, uninstalled and updated on Windows many times.

## Design rules

The window is deliberately plain. Every rule below is enforced by
`npm run sim:installer`, so a later change cannot quietly reintroduce what was
removed:

- one accent colour (white), one surface, hairline rules instead of shadows;
- **no** radial gradients, **no** box shadows, **no** backdrop blur, **no** text
  shadows, **no** type larger than 32px;
- one 120ms fade between screens, and nothing else moves;
- the film is the only colour in the window, and its absence is invisible.

If a design idea needs a glow to work, it is the wrong idea for this window.

## Files

| File | What it is |
| --- | --- |
| `ui/index.html`, `ui/style.css`, `ui/app.js` | the window: four steps, one decision per screen |
| `ui/background.mp4` | the film behind the scrim — **shipped as a resource, not inside the asar** |
| `main.js` | window, install, launch, close, and the film's real path |
| `preload.js` | the five things the page may ask for |
| `electron-builder.yml` | portable build, so the window never installs itself |
| `build/splash.bmp` | shown while the portable archive unpacks |

### Why the film is not in the asar

Chromium cannot stream a video out of an asar archive. The first build packed
`ui/background.mp4` into `app.asar`, so the `<video>` element errored, was
removed, and the window fell back to its placeholder — which at the time was a
large radial glow. That is the bug people saw. The film is now excluded from the
archive (`files: "!ui/background.mp4"`), copied next to the app as a resource,
and the page asks the main process for a `file://` URL. The page never builds a
path itself.

If a build has only a `.webm`, change the `extraResources` entry to match; the
page already prefers whatever the main process hands it.

## Watching it without building

The page runs in any browser:

```bash
cd installer/ui && python3 -m http.server 3000
```

With no bridge present it simulates the install, so the screens can be reviewed
without touching a machine. The film is picked up from the same folder, so the
background plays there too.

## Building it

`.github/workflows/installer.yml` does the whole thing on Windows and uploads
`INDRA-HUB-Setup-custom-<version>.exe` as an artifact, plus a downloadable
pre-release. It is intentionally not wired into `release.yml` as the primary
download: the wrapper must be installed, uninstalled and reinstalled by a person
before it replaces the download everyone else gets.
