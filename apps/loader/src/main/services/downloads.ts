import { BrowserWindow, net } from 'electron'
import { existsSync, renameSync, rmSync } from 'node:fs'
import type { InstallView, LoaderApp } from '@shared/types'
import { discardPartial, downloadToFile, resumableBytes } from '../lib/downloader'
import { loadCatalogue } from './catalog'
import { allInstalled, downloadTarget, installed, readRegistry, record } from './installed'
import { isRunning } from './launch'

/*
 * Downloading a product.
 *
 * One at a time, on purpose: three simultaneous 300 MB downloads finish later
 * than they would in sequence and make the progress on screen meaningless.
 *
 * The state of every product is broadcast after each change, so the card and the
 * detail panel are always showing the same truth — there is no second copy of
 * "downloading" anywhere.
 */

const entries = new Map<string, InstallView>()
const controllers = new Map<string, AbortController>()

/*
 * What the catalogue currently publishes, by id.
 *
 * Kept here rather than in the renderer because the decision it feeds — "this machine is
 * behind" — is a filesystem question, and it has to be answerable by the process that
 * owns the file. It is refreshed on every catalogue read.
 */
const published = new Map<string, { version: string; sha256: string }>()

/**
 * Is the build on this machine behind the one being published?
 *
 * Two answers, because there are two ways to fall behind. The version is the obvious
 * one — it is what the panel shows and what a person types when they publish. The hash
 * is the one that catches the case where somebody re-uploads a fixed executable and
 * forgets to change the version: same label, different file, and the customer would
 * otherwise never be told. Anything downloaded before the hash was recorded falls back
 * to the version alone.
 */
export function isStale(id: string): boolean {
  const newest = published.get(id)
  if (!newest) return false
  const here = installed(id)
  if (!here) return false
  if (here.version !== newest.version) return true
  if (newest.sha256 && here.sha256 && newest.sha256 !== here.sha256) return true
  return false
}

/**
 * Tell the downloader what the catalogue is currently offering.
 *
 * Called after every successful catalogue read. A product whose published version has
 * moved on becomes `update` on the next state read, with no further network traffic —
 * the version is already in the answer that was fetched for the library.
 */
export function noteCatalogue(apps: LoaderApp[]): void {
  let changed = false
  for (const app of apps) {
    const before = published.get(app.id)
    if (!before || before.version !== app.version || before.sha256 !== app.sha256) {
      published.set(app.id, { version: app.version, sha256: app.sha256 })
      changed = true
    }
  }
  if (changed) broadcast()
}

function broadcast(): void {
  const snapshot = states()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('files:state', snapshot)
  }
}

function set(id: string, patch: Partial<InstallView>): void {
  const current = entries.get(id) ?? {
    id,
    state: 'absent',
    latest: published.get(id)?.version ?? null,
    updating: false,
    running: false,
    percent: 0,
    received: 0,
    total: 0,
    bytesPerSecond: 0,
    error: null
  }
  entries.set(id, { ...current, ...patch })
  broadcast()
}

/**
 * Is anything downloading right now?
 *
 * Asked by the updater, which will not restart the app out from under a transfer
 * it would then have to start again. Read from memory on purpose: this is asked
 * on every window event, and the answer is only ever about work in flight.
 */
export function busy(): boolean {
  for (const view of entries.values()) {
    if (view.state === 'downloading') return true
  }
  return false
}

/**
 * Every product's state, starting from the disk.
 *
 * This used to start from the in-memory map, which is empty on every launch — so a
 * product downloaded yesterday reported "absent" today, and the Download button came back
 * for a file sitting in the library. The registry on disk is the first source now;
 * memory is only what overlays it while a download is actually running.
 */
export function states(): Record<string, InstallView> {
  const result: Record<string, InstallView> = {}

  // What is on disk, whether or not this process has ever touched it.
  for (const entry of allInstalled()) {
    const latest = published.get(entry.id)?.version ?? null
    // On disk and behind: still usable, no longer current.
    const behind = Boolean(latest && latest !== entry.version)
    result[entry.id] = {
      id: entry.id,
      state: behind ? 'update' : 'installed',
      latest,
      updating: false,
      running: isRunning(entry.id),
      percent: 100,
      received: entry.bytes,
      total: entry.bytes,
      bytesPerSecond: 0,
      error: null
    }
  }

  // What is happening right now, which beats what is on disk.
  for (const [id, view] of entries) {
    if (view.state === 'downloading' || view.state === 'error') {
      result[id] = view
      continue
    }
    const onDisk = installed(id)
    const latest = published.get(id)?.version ?? null
    const behind = Boolean(onDisk && latest && latest !== onDisk.version)
    result[id] = {
      ...view,
      latest,
      state: onDisk ? (behind ? 'update' : 'installed') : 'absent',
      running: onDisk ? isRunning(id) : false,
      percent: onDisk ? 100 : 0,
      received: onDisk ? onDisk.bytes : 0,
      total: onDisk ? onDisk.bytes : 0
    }
  }

  // A registry entry whose file has gone is not an installed app.
  for (const id of Object.keys(readRegistry())) {
    if (result[id]) continue
    result[id] = {
      id,
      state: 'absent',
      latest: published.get(id)?.version ?? null,
      updating: false,
      running: false,
      percent: 0,
      received: 0,
      total: 0,
      bytesPerSecond: 0,
      error: null
    }
  }

  return result
}

export function stateOf(id: string): InstallView {
  return (
    states()[id] ?? {
      id,
      state: 'absent',
      latest: published.get(id)?.version ?? null,
      updating: false,
      running: false,
      percent: 0,
      received: 0,
      total: 0,
      bytesPerSecond: 0,
      error: null
    }
  )
}

function findApp(apps: LoaderApp[], id: string): LoaderApp | null {
  return apps.find((app) => app.id === id) ?? null
}

export async function startDownload(id: string): Promise<InstallView> {
  if (entries.get(id)?.state === 'downloading') return stateOf(id)

  /*
   * Downloaded once means downloaded — unless the catalogue has moved on.
   *
   * A file that is already in the library is not fetched again for a reinstall, a
   * restart, or a second press of the button. But the products are rebuilt every month,
   * and a customer holding last month's executable has no way to know: the card said
   * DOWNLOADED and the button was gone. So a version that no longer matches what is
   * published is fetched, and replaces what is there.
   */
  const already = installed(id)
  const replace = already !== null && isStale(id)
  if (already && !replace) {
    set(id, {
      state: 'installed',
      percent: 100,
      received: already.bytes,
      total: already.bytes,
      bytesPerSecond: 0,
      error: null
    })
    return stateOf(id)
  }

  /*
   * A running executable is a locked file on Windows. Replacing it now would fail
   * halfway through, so the update waits for a launch that is not happening.
   */
  if (replace && isRunning(id)) return stateOf(id)

  for (const [otherId, view] of entries) {
    if (view.state === 'downloading' && otherId !== id) {
      return { ...stateOf(id), error: 'Another download is already running.' }
    }
  }

  const catalogue = await loadCatalogue()
  const app = findApp(catalogue.apps, id)
  if (!app) return { ...stateOf(id), error: 'This app is not published any more.' }

  // The URL comes from the catalogue, so it is checked before it is fetched.
  let url: URL
  try {
    url = new URL(app.fileUrl)
  } catch {
    return { ...stateOf(id), error: 'This app has no download link yet.' }
  }
  if (url.protocol !== 'https:') {
    return { ...stateOf(id), error: 'That download link is not secure, so it was refused.' }
  }

  const target = downloadTarget(app.name, app.version)

  /*
   * The file name carries the version, so a new build lands beside the old one and
   * nothing is written over a working executable. The one case that would collide is a
   * re-upload under the same version — same label, different bytes — and there the new
   * file is fetched under a temporary name and swapped in at the end.
   */
  const collide = existsSync(target.exe)
  const destination = collide ? `${target.exe}.new` : target.exe

  /*
   * A fragment from an attempt that died is kept and continued, not thrown away. It is
   * only thrown away when it is too old to be trusted, which is what `resumableBytes`
   * decides — the server honours `Range`, so a retry costs the remainder rather than the
   * whole file.
   */
  if (resumableBytes(destination) === 0) discardPartial(destination)

  let controller = new AbortController()
  controllers.set(id, controller)
  set(id, {
    state: 'downloading',
    updating: replace,
    percent: 0,
    received: 0,
    total: 0,
    bytesPerSecond: 0,
    error: null
  })

  /*
   * A transfer that stops moving is not a transfer.
   *
   * A connection that dies silently leaves a fetch that never resolves and never errors
   * — the bar sits at 0% forever and the app looks broken. Thirty seconds without a
   * single byte is not slow, it is dead: the attempt is aborted and continued from what
   * it already has.
   */
  const STALL_MS = 30_000
  const MAX_ATTEMPTS = 2
  let lastByteAt = Date.now()
  let stalled = false

  const watchdog = setInterval(() => {
    if (Date.now() - lastByteAt < STALL_MS) return
    stalled = true
    controller.abort()
  }, 2_000)

  const runOnce = () =>
    downloadToFile({
      url: url.toString(),
      destination,
      signal: controller.signal,
      // Chromium's stack: system proxy, system certificates, same redirect
      // behaviour as a browser. Node's fetch ignores proxy settings entirely.
      request: (input, init) => net.fetch(input, init as never),
      resumeFrom: resumableBytes(destination) || undefined,
      onProgress: (progress) => {
        lastByteAt = Date.now()
        set(id, {
          state: 'downloading',
          received: progress.received,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond,
          percent: progress.total > 0 ? Math.min(99, Math.round((progress.received / progress.total) * 100)) : 0
        })
      }
    })

  try {
    let result: Awaited<ReturnType<typeof downloadToFile>> | null = null
    let lastMessage = ''

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        result = await runOnce()
        break
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : String(error)

        // Somebody pressed Cancel: not a failure, and not something to retry.
        if (!stalled && controllers.get(id)?.signal.aborted) throw error
        if (stalled) {
          stalled = false
          lastByteAt = Date.now()
        }

        // A checksum disagreement means what we kept is wrong, so it cannot be continued.
        if (/checksum/i.test(lastMessage)) discardPartial(destination)

        if (attempt === MAX_ATTEMPTS) throw error

        /*
         * One more try, announced rather than silent — a retry the person can see is
         * better than a bar that jumps back to zero with no explanation.
         */
        console.warn('[downloads] retrying', id, lastMessage)
        controller = new AbortController()
        controllers.set(id, controller)
        set(id, {
          state: 'downloading',
          bytesPerSecond: 0,
          error: null,
          total: stateOf(id).total
        })
        lastByteAt = Date.now()
      }
    }

    if (!result) throw new Error(lastMessage || 'the download could not be completed')
    clearInterval(watchdog)

    /*
     * The swap.
     *
     * The old build is deleted and the new one renamed into its place, so the folder
     * holds exactly one executable for the product — no `.old`, no month-old copy eating
     * disk, nothing to clean up by hand. If the rename fails the old build is still
     * there, still launchable, and the file that was fetched is thrown away.
     */
    if (collide) {
      if (existsSync(target.exe)) rmSync(target.exe, { force: true })
      renameSync(result.path, target.exe)
      result.path = target.exe
    }

    /*
     * And the build it replaced is deleted, whichever version that was.
     *
     * The name changed when the version did, so the old file is a different file — it
     * would sit there forever otherwise, one executable per month ever published.
     */
    if (replace) {
      const previous = installed(id)
      if (previous && previous.exe !== result.path && existsSync(previous.exe)) {
        rmSync(previous.exe, { force: true })
      }
    }

    record({
      id,
      name: app.name,
      version: app.version,
      sha256: app.sha256 || undefined,
      exe: result.path,
      bytes: result.bytes,
      downloadedAt: new Date().toISOString()
    })

    set(id, { state: 'installed', updating: false, percent: 100, bytesPerSecond: 0, error: null })

    /*
     * A replacement that nobody saw is indistinguishable from a replacement that never
     * happened — and it happens in about a second on a small installer, entirely behind
     * whatever screen the person is looking at. So the one moment that matters is
     * announced: the product, and the version it now is.
     */
    if (replace) {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send('files:updated', {
            id,
            name: app.name,
            version: app.version
          })
        }
      }
    }

    return stateOf(id)
  } catch (error) {
    if (controller.signal.aborted && !stalled) {
      /*
       * Cancelled. A cancelled replacement leaves the old build exactly where it was,
       * so the product goes back to offering the update rather than claiming to be
       * absent — which would put a Download button next to a file that is right there.
       */
      const kept = installed(id)
      set(id, {
        state: kept ? (isStale(id) ? 'update' : 'installed') : 'absent',
        updating: false,
        percent: 0,
        received: kept?.bytes ?? 0,
        bytesPerSecond: 0,
        error: null
      })
      return stateOf(id)
    }

    const message = error instanceof Error ? error.message : String(error)
    console.error('[downloads] failed', id, message)
    /*
     * A failed replacement is not a failed download. The product still opens — it is
     * last month's build — so the card keeps saying UPDATE and tries again later.
     */
    if (replace) {
      discardPartial(destination)
      set(id, { state: 'update', updating: false, percent: 100, bytesPerSecond: 0, error: null })
      return stateOf(id)
    }
    set(id, {
      state: 'error',
      percent: 0,
      bytesPerSecond: 0,
      error: /checksum/i.test(message)
        ? 'The file arrived damaged and was discarded. Try again.'
        : /HTTP (404|410)/.test(message)
          ? /*
             * The row exists and the file does not — deleted from the panel, or from the
             * bucket by hand. Saying "404" would send somebody to look at their
             * connection.
             */
            'This file is no longer on the server. Ask the admin to upload it again.'
          : /HTTP (\d+)/.test(message)
            ? `The download server answered ${message.match(/HTTP (\d+)/)?.[0]}.`
          : stalled
            ? 'The connection stopped responding. Download again to continue from where it stopped.'
            : 'The download could not be completed. Check the connection and try again.'
    })
    return stateOf(id)
  } finally {
    clearInterval(watchdog)
    controllers.delete(id)
  }
}

export function cancelDownload(id: string): InstallView {
  controllers.get(id)?.abort()
  return stateOf(id)
}

export function uninstall(id: string): InstallView {
  const entry = installed(id)
  if (entry && existsSync(entry.exe)) {
    try {
      const { unlinkSync } = require('node:fs') as typeof import('node:fs')
      unlinkSync(entry.exe)
    } catch (error) {
      console.error('[downloads] could not delete', entry.exe, error)
    }
  }
  set(id, { state: 'absent', percent: 0, received: 0, total: 0, bytesPerSecond: 0, error: null })
  return stateOf(id)
}
