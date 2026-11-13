# The installer window

This folder is the installer people actually see: a frameless dark window with a
video background, built as its own small Electron app.

It does not reimplement installing. `payload/inder-setup.exe` is the stock NSIS
installer produced by the main build; this window passes it `/S` plus the scope
the person chose, watches the install folder fill up so the progress bar is real,
and then launches the app. Shortcuts, the uninstall entry, per-user versus
per-machine folders and the updater stay NSIS's job — code that has been
installed, uninstalled and updated on Windows many times.

## Files

| File | What it is |
| --- | --- |
| `ui/index.html`, `ui/style.css`, `ui/app.js` | the window: four steps, one decision per screen |
| `ui/background.mp4` (or `.webm`) | optional film behind the scrim; the design is complete without it |
| `main.js` | window, install, launch, close |
| `preload.js` | the four things the page may ask for |
| `electron-builder.yml` | portable build, so the window never installs itself |
| `build/splash.bmp` | shown while the portable archive unpacks |

## Watching it without building

The page runs in any browser:

```bash
cd installer/ui && python3 -m http.server 3000
```

With no bridge present it simulates the install, so the screens can be reviewed
without touching a machine.

## Building it

`.github/workflows/installer.yml` does the whole thing on Windows and uploads
`INDRA-HUB-Setup-custom-<version>.exe` as an artifact. It is intentionally not
wired into `release.yml`: the wrapper must be installed, uninstalled and
reinstalled by a person before it replaces the download everyone else gets.
