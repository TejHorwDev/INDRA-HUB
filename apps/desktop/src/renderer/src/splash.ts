/*
 * The launch window's renderer.
 *
 * It knows one thing: how to put a sentence under the ring, with a fade so the
 * change reads as progress rather than a jump. Nothing about updates is decided
 * here — the main process checks, downloads and restarts, and tells this page
 * which stage it is in.
 */

type Stage = 'checking' | 'downloading' | 'restarting' | 'closing'

const STAGES: Record<Exclude<Stage, 'closing'>, string> = {
  checking: 'Checking for updates…',
  downloading: 'Downloading update 1 of 1…',
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

  const text = STAGES[stage]
  if (line.textContent === text) return

  /* Fade the old sentence out, swap, fade the new one in. */
  line.classList.add('is-swapping')
  window.setTimeout(() => {
    line.textContent = text
    line.classList.toggle('is-final', stage === 'restarting')
    line.classList.remove('is-swapping')
  }, 170)
}

if (window.launch) {
  window.launch.onStage(show)
  window.launch.ready()
} else {
  /*
   * Opened outside the app — a stylesheet proof, or a stray file:// hit. It
   * still has to be a page rather than a blank rectangle.
   */
  show('checking')
}

export {}
