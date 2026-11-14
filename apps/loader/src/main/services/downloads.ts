import { BrowserWindow, net } from 'electron'
import { existsSync } from 'node:fs'
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
    result[entry.id] = {
      id: entry.id,
      state: 'installed',
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
    result[id] = {
      ...view,
      state: onDisk ? 'installed' : 'absent',
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
   * Downloaded once means downloaded. A file that is already in the library is not
   * fetched again — not for a reinstall, not after a restart, and not because somebody
   * pressed the button twice. Bandwidth is the reason this feature exists: one machine,
   * one copy.
   */
  const already = installed(id)
  if (already) {
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

  const target = downloadTarget(app.name)

  /*
   * A fragment from an attempt that died is kept and continued, not thrown away. It is
   * only thrown away when it is too old to be trusted, which is what `resumableBytes`
   * decides — the server honours `Range`, so a retry costs the remainder rather than the
   * whole file.
   */
  if (resumableBytes(target.exe) === 0) discardPartial(target.exe)

  let controller = new AbortController()
  controllers.set(id, controller)
  set(id, { state: 'downloading', percent: 0, received: 0, total: 0, bytesPerSecond: 0, error: null })

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
      destination: target.exe,
      signal: controller.signal,
      // Chromium's stack: system proxy, system certificates, same redirect
      // behaviour as a browser. Node's fetch ignores proxy settings entirely.
      request: (input, init) => net.fetch(input, init as never),
      resumeFrom: resumableBytes(target.exe) || undefined,
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
        if (/checksum/i.test(lastMessage)) discardPartial(target.exe)

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

    record({
      id,
      name: app.name,
      version: app.version,
      exe: result.path,
      bytes: result.bytes,
      downloadedAt: new Date().toISOString()
    })

    set(id, { state: 'installed', percent: 100, bytesPerSecond: 0, error: null })
    return stateOf(id)
  } catch (error) {
    if (controller.signal.aborted && !stalled) {
      set(id, { state: 'absent', percent: 0, received: 0, bytesPerSecond: 0, error: null })
      return stateOf(id)
    }

    const message = error instanceof Error ? error.message : String(error)
    console.error('[downloads] failed', id, message)
    set(id, {
      state: 'error',
      percent: 0,
      bytesPerSecond: 0,
      error: /checksum/i.test(message)
        ? 'The file arrived damaged and was discarded. Try again.'
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
