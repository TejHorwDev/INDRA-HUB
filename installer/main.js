/*
 * INDRA HUB Setup — the window, and the only thing that touches the machine.
 *
 * The install itself is not reimplemented here. A real NSIS installer travels
 * inside this app (`resources/inder-setup.exe`) and runs silently: it creates
 * the shortcuts, writes the uninstall entry, handles per-user versus per-machine
 * folders, and is the same code path a stock install has always used. This
 * process only draws the window, passes the answers it collected, and watches
 * the folder fill up so the progress bar is real rather than decorative.
 *
 * Why not draw the wizard in NSIS? Because the design in `ui/` — a frameless
 * window, a video behind it, a folder picker — is beyond what NSIS can paint.
 * The installer people see is Electron; the installer that does the work is the
 * one that has already been tested on Windows a dozen times.
 */

const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron')
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

/** The folder the installer suggests, given the choice made in the window. */
function defaultRoot(scope) {
  if (scope === 'machine') {
    return path.join(process.env.ProgramFiles || 'C:\\Program Files', APP_NAME)
  }
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', APP_NAME)
}

const INVALID_CHARS = /[<>:"|?*\u0000-\u001f]/
const RESERVED = [
  'c:\\windows',
  'c:\\windows\\system32',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\users',
  'c:\\programdata'
]

/**
 * The folder to install into, from what the window asked for.
 *
 * The page validates as you type, but this is the check that matters: a folder
 * path ends up on a command line, and the renderer is the least trusted part of
 * the process. Anything that is not an absolute drive path inside a sensible
 * folder is refused, and the refusal names the reason.
 */
function resolveTarget(scope, requested) {
  if (typeof requested !== 'string') {
    return { ok: false, message: 'No install folder was chosen.' }
  }
  const raw = requested.trim()
  if (!raw) return { ok: false, message: 'No install folder was chosen.' }
  if (!/^[a-zA-Z]:\\/.test(raw)) {
    return { ok: false, message: 'The install folder must be a full Windows path, like C:\\Program Files\\INDRA HUB.' }
  }
  if (raw.length > 170) return { ok: false, message: 'That install folder path is too long.' }
  if (INVALID_CHARS.test(raw.slice(2))) {
    return { ok: false, message: 'The install folder cannot contain < > : " | ? *' }
  }

  const dir = path.resolve(raw.replace(/[\\/]+$/, ''))
  if (dir.length <= 3) return { ok: false, message: 'Choose a folder inside the drive, not the drive itself.' }
  if (RESERVED.includes(dir.toLowerCase())) {
    return { ok: false, message: 'Choose a folder for the app, not a system folder.' }
  }
  return { ok: true, dir }
}

/** Bytes on disk under a folder, or 0 when it does not exist yet. */
function folderBytes(dir) {
  let total = 0
  const stack = [dir]
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
    width: 880,
    height: 580,
    minWidth: 820,
    minHeight: 540,
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

ipcMain.handle('setup:defaults', () => ({
  user: defaultRoot('user'),
  machine: defaultRoot('machine')
}))

/** The folder picker. The page may suggest a starting folder; it cannot pick one. */
ipcMain.handle('setup:choose-folder', async (_event, suggested) => {
  const start = typeof suggested === 'string' && /^[a-zA-Z]:\\/.test(suggested) ? suggested : defaultRoot('user')
  const answer = await dialog.showOpenDialog(window, {
    title: 'Choose where INDRA HUB is installed',
    defaultPath: start,
    buttonLabel: 'Use this folder',
    properties: ['openDirectory', 'createDirectory'],
    noLink: true
  })
  if (answer.canceled || answer.filePaths.length === 0) return null
  return answer.filePaths[0]
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

  const target = resolveTarget(scope, options?.path)
  if (!target.ok) return { ok: false, message: target.message }

  const archive = fs.statSync(installer).size

  /*
   * `/S` is silence, `/allusers` or `/currentuser` is the scope, and `/D=` is the
   * folder. NSIS insists that `/D=` is the last argument and that it is **not**
   * quoted — even when the path contains spaces — so the whole command line is
   * passed through verbatim rather than assembled with quotes.
   */
  const commandLine = ['/S', scope === 'machine' ? '/allusers' : '/currentuser', `/D=${target.dir}`]

  const send = (payload) => {
    if (!event.sender.isDestroyed()) event.sender.send('setup:progress', payload)
  }

  send({ percent: 6, stage: 'Preparing…' })

  const child = spawn(installer, commandLine, {
    windowsHide: true,
    windowsVerbatimArguments: true
  })

  const timer = setInterval(() => {
    const landed = folderBytes(target.dir)
    const percent = Math.min(96, Math.max(8, Math.round((landed / archive) * 100)))
    const stage =
      percent < 30 ? 'Copying files…' : percent < 80 ? 'Installing files…' : 'Creating shortcuts…'
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
        resolve({
          ok: false,
          message: `The installer stopped with code ${code}. That usually means the folder cannot be written to by this account.`
        })
        return
      }
      const exe = path.join(target.dir, EXE_NAME)
      if (!fs.existsSync(exe)) {
        resolve({ ok: false, message: 'The installer finished, but the app is not in the folder you chose.' })
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
