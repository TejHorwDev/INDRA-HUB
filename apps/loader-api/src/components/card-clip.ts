/*
 * Turning a video into something a card can actually play.
 *
 * A card is 232 pixels square. People upload a 1080p clip recorded at 60 frames a second
 * and Chromium dutifully decodes every one of those pixels — twice over, because the film
 * behind the window is decoding too — and on a machine without hardware video decode that
 * is a slideshow. Nothing about the file is *wrong*; it is simply a hundred times larger
 * than the thing displaying it.
 *
 * So the browser shrinks it once, at upload time, and the app only ever plays the small
 * copy: 512×512, 30fps, VP9 in WebM, a few hundred kilobytes. It also launders every
 * awkward source — H.265, variable frame rate, a phone recording with a rotation flag —
 * because the result is a plain WebM that any Chromium can decode in its sleep.
 *
 * This runs in the admin's browser and never on the server, which is the only place it
 * could run: no ffmpeg, no queue, no waiting.
 */

const TARGET = 512
const MAX_SECONDS = 4
const FPS = 30

export interface CardClip {
  file: File
  /** What happened, for the notice under the field. */
  note: string
}

function pickMime(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ]
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) {
      return candidate
    }
  }
  return ''
}

/** Waits for one media event, or fails after a generous moment. */
function once(element: HTMLMediaElement, event: string, timeout = 8_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`no ${event}`)), timeout)
    element.addEventListener(
      event,
      () => {
        window.clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

/**
 * A card-sized copy of `file`, or the original when it cannot be made.
 *
 * Everything here degrades: an undecodable file, an old Chromium with no MediaRecorder, a
 * canvas that refuses a frame — all of them return the original upload and a note saying
 * so. A video that is merely large is far better than no video at all.
 */
export async function prepareCardClip(file: File, onStep?: (step: string) => void): Promise<CardClip> {
  const mime = pickMime()
  if (!mime || typeof document === 'undefined') {
    return { file, note: 'Uploaded as it is — this browser cannot prepare a card copy.' }
  }

  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'

  try {
    onStep?.('Reading the video')
    await once(video, 'loadeddata')

    const side = Math.min(video.videoWidth, video.videoHeight)
    if (!side) return { file, note: 'Uploaded as it is — the video could not be read.' }
    // Nothing to gain from shrinking something that is already card-sized.
    if (side <= TARGET && file.size < 2 * 1024 * 1024) {
      return { file, note: `Uploaded as it is — already ${side}px, ${Math.round(file.size / 1024)} KB.` }
    }

    const canvas = document.createElement('canvas')
    canvas.width = TARGET
    canvas.height = TARGET
    const context = canvas.getContext('2d')
    if (!context) return { file, note: 'Uploaded as it is — no canvas to draw on.' }

    const stream = canvas.captureStream(FPS)
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_200_000 })
    const chunks: BlobPart[] = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
    })

    onStep?.('Preparing a card-sized copy')
    recorder.start()
    await video.play().catch(() => undefined)

    const startedAt = performance.now()
    await new Promise<void>((resolve) => {
      const draw = (): void => {
        const elapsed = (performance.now() - startedAt) / 1000
        if (video.ended || elapsed >= MAX_SECONDS) {
          resolve()
          return
        }
        // Centre crop: a card is square and the artwork fills it, so the middle of the
        // frame is what the card would have shown.
        const left = (video.videoWidth - side) / 2
        const top = (video.videoHeight - side) / 2
        context.drawImage(video, left, top, side, side, 0, 0, TARGET, TARGET)
        requestAnimationFrame(draw)
      }
      requestAnimationFrame(draw)
    })

    recorder.stop()
    await stopped
    video.pause()

    const blob = new Blob(chunks, { type: mime.split(';')[0] })
    if (blob.size === 0) return { file, note: 'Uploaded as it is — the card copy came out empty.' }

    // If the re-encode is not actually smaller, the original was fine.
    if (blob.size >= file.size) {
      return { file, note: `Uploaded as it is — already efficient at ${Math.round(file.size / 1024)} KB.` }
    }

    const name = `${file.name.replace(/\.[^.]+$/, '')}.webm`
    return {
      file: new File([blob], name, { type: 'video/webm' }),
      note: `Card copy prepared: 512px WebM, ${Math.round(blob.size / 1024)} KB instead of ${Math.round(file.size / 1024)} KB.`
    }
  } catch (error) {
    console.warn('[card-clip] could not prepare', error)
    return { file, note: 'Uploaded as it is — this video could not be re-encoded here.' }
  } finally {
    video.pause()
    URL.revokeObjectURL(url)
  }
}

/** True for the formats a card accepts as moving artwork. */
export function isVideoFile(file: File): boolean {
  return /^video\//.test(file.type) || /\.(mp4|webm|mov|m4v)$/i.test(file.name)
}
