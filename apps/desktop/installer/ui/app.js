/*
 * The installer's screens, and nothing else.
 *
 * One state machine: options → ready → installing → completed. Everything that
 * touches the machine is behind `window.setup` (the preload bridge); when that
 * bridge is absent — this page opened in a browser for review — the same screens
 * run on a simulated install, so the design can be judged without installing.
 *
 * The folder is chosen here, but it is only a suggestion: the main process
 * validates it again and is the one that passes it to the installer.
 */

const bridge = window.setup ?? null

const state = {
  screen: 'options',
  scope: 'user',
  path: '',
  /** True until the person types in the field, so the scope can move the default. */
  followDefault: true,
  percent: 0,
  installed: false
}

const screens = new Map(
  [...document.querySelectorAll('.screen')].map((node) => [node.dataset.screen, node])
)
const steps = new Map([...document.querySelectorAll('.step')].map((node) => [node.dataset.step, node]))
const order = ['options', 'ready', 'installing', 'completed']

const nextButton = document.getElementById('next')
const cancelButton = document.getElementById('cancel')
const bar = document.getElementById('bar')
const fill = document.getElementById('fill')
const percentCopy = document.getElementById('percent')
const stageCopy = document.getElementById('install-stage')
const noteCopy = document.getElementById('install-note')
const errorCopy = document.getElementById('error')
const reviewScope = document.getElementById('review-scope')
const reviewPath = document.getElementById('review-path')
const reviewVersion = document.getElementById('review-version')
const completedPath = document.getElementById('completed-path')
const launchBox = document.getElementById('launch')
const versionTag = document.getElementById('version')
const pathInput = document.getElementById('path')
const pathHint = document.getElementById('path-hint')
const browseButton = document.getElementById('browse')

const HINT = pathHint.textContent

/* Defaults, so the page is complete before the bridge answers (or without it). */
let defaults = {
  user: 'C:\\Users\\you\\AppData\\Local\\Programs\\INDRA HUB',
  machine: 'C:\\Program Files\\INDRA HUB'
}

const INVALID_CHARS = /[<>:"|?*\u0000-\u001f]/
/*
 * Both rules come from the module the main process uses too, so what this page
 * shows and what the installer enforces cannot drift apart. If the script is
 * missing, the page still works and the main process still refuses a bad path.
 */
const rules = window.IndraFolder ?? {}
const ensureAppFolder = (value) =>
  typeof rules.ensureAppFolder === 'function' ? rules.ensureAppFolder(value) : String(value ?? '').trim()
const pathProblem = (value) => (typeof rules.pathProblem === 'function' ? rules.pathProblem(value) : null)

/* ---------------- painting ---------------- */

function paint() {
  for (const [name, node] of screens) {
    node.classList.toggle('is-current', name === state.screen)
  }

  const here = order.indexOf(state.screen)
  for (const [name, node] of steps) {
    const at = order.indexOf(name)
    node.classList.toggle('is-active', at === here)
    node.classList.toggle('is-done', at < here)
  }

  const scopeName = state.scope === 'machine' ? 'Everyone on this PC' : 'Only me'
  reviewScope.textContent = scopeName
  reviewPath.textContent = state.path

  const problem = pathProblem(state.path)
  pathInput.classList.toggle('is-invalid', Boolean(problem))
  pathInput.setAttribute('aria-invalid', problem ? 'true' : 'false')
  pathHint.classList.toggle('is-error', Boolean(problem))
  pathHint.textContent = problem ?? HINT

  const label =
    state.screen === 'options'
      ? 'Continue'
      : state.screen === 'ready'
        ? 'Install'
        : state.screen === 'installing'
          ? 'Installing…'
          : 'Finish'

  nextButton.textContent = label
  nextButton.disabled = state.screen === 'installing' || Boolean(problem)
  cancelButton.textContent = state.screen === 'completed' ? 'Close' : 'Cancel'

  const percent = Math.round(state.percent)
  bar.setAttribute('aria-valuenow', String(percent))
  fill.style.width = `${percent}%`
  percentCopy.textContent = `${percent}%`
}

function go(screen) {
  state.screen = screen
  paint()
}

function showError(message) {
  errorCopy.textContent = message
  errorCopy.hidden = false
}

function clearError() {
  errorCopy.textContent = ''
  errorCopy.hidden = true
}

/* ---------------- choosing ---------------- */

for (const choice of document.querySelectorAll('.choice')) {
  choice.addEventListener('click', () => {
    if (state.screen !== 'options') return
    const scope = choice.dataset.scope
    state.scope = scope
    if (state.followDefault) {
      state.path = defaults[scope] ?? state.path
      pathInput.value = state.path
    }
    for (const other of document.querySelectorAll('.choice')) {
      const selected = other === choice
      other.classList.toggle('is-selected', selected)
      other.setAttribute('aria-checked', String(selected))
    }
    paint()
  })
}

pathInput.addEventListener('input', () => {
  state.followDefault = false
  state.path = pathInput.value
  paint()
})

pathInput.addEventListener('blur', () => {
  /* Tidy what people type: no trailing slash, trimmed. */
  const tidied = ensureAppFolder(pathInput.value)
  if (tidied && tidied !== pathInput.value) {
    pathInput.value = tidied
    state.path = tidied
    paint()
  }
})

browseButton.addEventListener('click', async () => {
  if (!bridge?.chooseFolder) return
  try {
    const picked = await bridge.chooseFolder(pathInput.value.trim())
    if (!picked) return
    state.path = ensureAppFolder(picked)
    state.followDefault = false
    pathInput.value = state.path
    paint()
  } catch {
    /* A cancelled dialog is not an error; anything else keeps the old value. */
  }
})

/* ---------------- installing ---------------- */

function setStage(text, note) {
  if (text) stageCopy.textContent = text
  if (note !== undefined) noteCopy.textContent = note
}

async function install() {
  clearError()
  go('installing')
  state.percent = 2
  paint()
  setStage('Preparing…', 'This takes a few seconds.')
  completedPath.textContent = `Installed to ${state.path}`

  if (!bridge) {
    /* Review mode: the same beats, at reading speed. */
    const beats = [
      [24, 'Copying files…'],
      [58, 'Copying files…'],
      [82, 'Creating shortcuts…'],
      [96, 'Finishing…']
    ]
    for (const [percent, label] of beats) {
      setStage(label)
      state.percent = percent
      paint()
      await new Promise((done) => setTimeout(done, 480))
    }
    state.percent = 100
    paint()
    state.installed = true
    go('completed')
    return
  }

  bridge.onProgress((event) => {
    state.percent = Math.max(0, Math.min(100, Number(event.percent) || 0))
    if (event.stage) setStage(event.stage)
    paint()
  })

  try {
    const result = await bridge.install({ scope: state.scope, path: state.path })
    if (!result?.ok) throw new Error(result?.message || 'The installation did not complete.')
    state.percent = 100
    paint()
    if (typeof result.dir === 'string' && result.dir) {
      state.path = result.dir
      completedPath.textContent = `Installed to ${result.dir}`
    }
    state.installed = true
    go('completed')
  } catch (error) {
    state.percent = 0
    go('ready')
    showError(`${error?.message ?? error} Nothing else on this PC was changed — you can try again.`)
  }
}

/* ---------------- the one button ---------------- */

nextButton.addEventListener('click', () => {
  if (nextButton.disabled) return undefined
  if (state.screen === 'options') {
    if (pathProblem(state.path)) {
      pathInput.focus()
      return undefined
    }
    return go('ready')
  }
  if (state.screen === 'ready') return void install()
  if (state.screen === 'completed') return finish()
  return undefined
})

function cancel() {
  if (bridge) return bridge.close()
  if (state.screen === 'completed' || state.screen !== 'options') return go('options')
  return undefined
}

cancelButton.addEventListener('click', cancel)

function finish() {
  if (bridge) {
    bridge.finish({ launch: launchBox.checked })
    return
  }
  go('options')
}

document.querySelector('[data-win="close"]')?.addEventListener('click', () => {
  if (bridge) bridge.close()
  else window.close()
})
document.querySelector('[data-win="minimise"]')?.addEventListener('click', () => {
  bridge?.minimise()
})

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
    return
  }
  if (event.key === 'Enter' && !nextButton.disabled && document.activeElement !== pathInput) {
    event.preventDefault()
    nextButton.click()
  }
})

/* ---------------- the film ---------------- */

/*
 * The background is optional and its absence is invisible: a window with no
 * video is a flat near-black frame, which is the design, not a failure.
 *
 * The main process hands over an absolute path because the file is shipped
 * beside the app (`resources/background.mp4`) rather than packed into the asar
 * archive — Chromium cannot stream media out of an archive.
 */
async function startBackdrop() {
  const video = document.getElementById('video')
  if (!video) return

  let live = false
  let dead = false
  const candidates = []

  if (bridge?.background) {
    try {
      const url = await bridge.background()
      if (typeof url === 'string' && url) candidates.push(url)
    } catch {
      /* No film in this build. */
    }
  }
  candidates.push(new URL('background.mp4', document.baseURI).href)

  let index = 0

  const giveUp = () => {
    if (live || dead) return
    if (video.readyState >= 2) return landed()
    dead = true
    video.remove()
  }

  const next = () => {
    if (live || dead) return
    const source = candidates[index]
    index += 1
    if (!source) return giveUp()
    video.src = source
    video.load()
    /* play() returns a promise in Chromium and undefined elsewhere — a missing
       promise must not take the whole window down with it. */
    const playing = video.play?.()
    if (playing && typeof playing.catch === 'function') playing.catch(() => undefined)
  }

  const landed = () => {
    live = true
    video.classList.add('is-live')
  }

  video.addEventListener('playing', landed)
  video.addEventListener('canplay', landed)
  video.addEventListener('error', () => {
    if (!live) next()
  })

  setTimeout(giveUp, 8000)

  next()
}

/* ---------------- start ---------------- */

async function start() {
  if (bridge?.defaults) {
    try {
      const values = await bridge.defaults()
      if (values?.user) defaults.user = values.user
      if (values?.machine) defaults.machine = values.machine
    } catch {
      /* Keep the placeholders. */
    }
  }

  state.path = defaults[state.scope]
  pathInput.value = state.path

  if (bridge?.version) {
    bridge
      .version()
      .then((value) => {
        if (!value) return
        versionTag.textContent = `v${value}`
        reviewVersion.textContent = value
      })
      .catch(() => undefined)
  }

  void startBackdrop()
  paint()
}

void start()
