/*
 * INDRA HUB Setup — the window, and the only thing that touches the machine.
 *
 * The install itself is not reimplemented here. A real NSIS installer travels
 * inside this app (`resources/inder-setup.exe`) and runs silently: it creates
 * the shortcuts, writes the uninstall entry, handles per-user versus per-machine
 * folders, and is the same code path a stock install has always used. This
 * process only draws the window, passes the two answers it collected, and
 * watches the folder fill up so the progress bar is real rather than decorative.
 *
 * Why not draw the wizard in NSIS? Because the design in `ui/` — a frameless
 * window, a video behind it, cards, a step rail — is beyond what NSIS can paint.
 * The installer people see is Electron; the installer that does the work is the
 * one that has already been tested on Windows a dozen times.
 */

const { app, BrowserWindow, Menu, ipcMain } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const APP_NAME = 'INDRA HUB'
const EXE_NAME = 'INDRA HUB.exe'
const VERSION = app.getVersion()

/** Where the bundled NSIS installer lives, in both dev and packaged runs. */
function innerInstaller() {
  const packaged = path.join(process.resourcesPath, 'inder-setup.exe')
  return fs.existsSync(packaged) ? packaged : path.join(__dirname, 'payload', 'inder-setup.exe')
}

/**
 * The film behind the window, if this build was given one.
 *
 * It is shipped as a resource rather than inside `ui/`, because Chromium cannot
 * stream a video out of an asar archive — the first build put it there and the
 * background silently stayed black. Packaged builds look beside the app;
 * `npm start` in this folder looks in `ui/`.
 */
function backgroundFilm() {
  const packaged = path.join(process.resourcesPath, 'background.mp4')
  if (fs.existsSync(packaged)) return packaged
  const local = path.join(__dirname, 'ui', 'background.mp4')
  return fs.existsSync(local) ? local : null
}

/** Where NSIS will put the app, given the choice made in the window. */
function installRoot(scope) {
  if (scope === 'machine') {
    return path.join(process.env.ProgramFiles || 'C:\\Program Files', APP_NAME)
  }
  return path.join(process.env.LOCALAPPDATA || os.homedir(), 'Programs', APP_NAME)
}

/** Bytes on disk under a folder, or 0 when it does not exist yet. */
function folderBytes(dir) {
  let total = 0
  let stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      try {
        if (entry.isDirectory()) stack.push(full)
        else total += fs.statSync(full).size
      } catch {
        // A file that vanished mid-walk is not a failure.
      }
    }
  }
  return total
}

let window = null
let installedExe = null

function createWindow() {
  window = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 1000,
    minHeight: 660,
    frame: false,
    show: false,
    backgroundColor: '#08080a',
    title: `${APP_NAME} Setup`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())
  window.loadFile(path.join(__dirname, 'ui', 'index.html'))
  window.on('closed', () => {
    window = null
  })
}

/* A frameless installer has no menu; Alt would otherwise still open one. */
Menu.setApplicationMenu(null)
/* Muted autoplay is allowed anyway; this keeps it true if the policy changes. */
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => app.quit())

/* ------------------------------------------------------------------ */
/* What the window can ask for                                         */
/* ------------------------------------------------------------------ */

ipcMain.handle('setup:version', () => VERSION)

ipcMain.handle('setup:background', () => {
  const film = backgroundFilm()
  return film ? pathToFileURL(film).toString() : null
})
ipcMain.handle('setup:minimise', () => window?.minimize())
ipcMain.handle('setup:close', () => app.quit())

/**
 * Runs the bundled installer and reports progress while it works.
 *
 * Progress comes from the install folder itself: NSIS in silent mode prints
 * nothing, so the only honest signal is how much has landed on disk. The target
 * is the size of the archive it is unpacking, which is close enough to watch it
 * move and is never ahead of the work.
 */
ipcMain.handle('setup:install', async (event, options) => {
  const scope = options?.scope === 'machine' ? 'machine' : 'user'
  const installer = innerInstaller()

  if (!fs.existsSync(installer)) {
    return { ok: false, message: 'The installer payload is missing from this build.' }
  }

  const target = installRoot(scope)
  const archive = fs.statSync(installer).size

  /*
   * `/S` is silence, and the scope flag decides the folder. A per-machine
   * install writes to Program Files, so Windows shows its own consent prompt for
   * the child process; this window stays exactly as it is.
   */
  const args = ['/S', scope === 'machine' ? '/allusers' : '/currentuser']

  const send = (payload) => {
    if (!event.sender.isDestroyed()) event.sender.send('setup:progress', payload)
  }

  send({ percent: 6, stage: 'Preparing…' })

  const child = spawn(installer, args, { windowsHide: true })

  const timer = setInterval(() => {
    const landed = folderBytes(target)
    const percent = Math.min(96, Math.max(8, Math.round((landed / archive) * 100)))
    const stage =
      percent < 30 ? 'Unpacking the app…' : percent < 80 ? 'Installing files…' : 'Creating shortcuts…'
    send({ percent, stage })
  }, 400)

  return await new Promise((resolve) => {
    child.on('error', (error) => {
      clearInterval(timer)
      resolve({ ok: false, message: `The installer could not start: ${error.message}` })
    })
    child.on('exit', (code) => {
      clearInterval(timer)
      if (code !== 0) {
        resolve({ ok: false, message: `The installer stopped with code ${code}.` })
        return
      }
      const exe = path.join(target, EXE_NAME)
      if (!fs.existsSync(exe)) {
        resolve({ ok: false, message: 'The installer finished but the app is not where it should be.' })
        return
      }
      installedExe = exe
      send({ percent: 100, stage: 'Done.' })
      resolve({ ok: true, exe })
    })
  })
})

ipcMain.handle('setup:finish', (_event, payload) => {
  if (payload?.launch && installedExe) {
    spawn(installedExe, [], { detached: true, stdio: 'ignore' }).unref()
  }
  setTimeout(() => app.quit(), 120)
})
