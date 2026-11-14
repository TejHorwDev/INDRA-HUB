/*
 * The launch card's renderer.
 *
 * It knows one thing: how to put a sentence under the ring, with a fade, so a
 * change reads as progress rather than a jump. Nothing about updates is decided
 * here — the main process checks, downloads and restarts, and tells this page
 * which stage it is in.
 */
import './styles/splash.css'

type Stage = 'checking' | 'downloading' | 'restarting' | 'closing'

const STAGES: Record<Exclude<Stage, 'closing'>, string> = {
  checking: 'Checking for updates…',
  downloading: 'Downloading update…',
  restarting: 'Restarting…'
}

declare global {
  interface Window {
    launch?: {
      onStage: (listener: (stage: Stage) => void) => void
      ready: () => void
    }
  }
}

const line = document.getElementById('stage')

function show(stage: Stage): void {
  if (!line) return
  if (stage === 'closing') {
    document.body.classList.add('is-closing')
    return
  }

  const text = STAGES[stage] ?? STAGES.checking
  if (line.textContent === text) return

  line.classList.add('is-swapping')
  window.setTimeout(() => {
    line.textContent = text
    line.classList.toggle('is-final', stage === 'restarting')
    line.classList.remove('is-swapping')
  }, 160)
}

if (window.launch) {
  window.launch.onStage(show)
  window.launch.ready()
} else {
  // Opened outside the app: still a page, not a blank rectangle.
  show('checking')
}

export {}
