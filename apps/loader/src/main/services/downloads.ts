import { BrowserWindow, net } from 'electron'
import { existsSync } from 'node:fs'
import type { InstallView, LoaderApp } from '@shared/types'
import { discardPartial, downloadToFile } from '../lib/downloader'
import { loadCatalogue } from './catalog'
import { downloadTarget, installed, record } from './installed'
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

/** Every product's state, with the disk consulted rather than remembered. */
export function states(): Record<string, InstallView> {
  const result: Record<string, InstallView> = {}
  for (const [id, view] of entries) result[id] = view

  // Anything not currently downloading is whatever the disk and the process
  // table say, rather than what was last remembered.
  for (const id of Object.keys(result)) {
    if (result[id].state === 'downloading') continue
    if (!installed(id)) {
      result[id] = { ...result[id], state: 'absent', percent: 0, running: false }
      continue
    }
    result[id] = { ...result[id], state: 'installed', running: isRunning(id) }
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
  discardPartial(target.exe)

  const controller = new AbortController()
  controllers.set(id, controller)
  set(id, { state: 'downloading', percent: 0, received: 0, total: 0, bytesPerSecond: 0, error: null })

  try {
    const result = await downloadToFile({
      url: url.toString(),
      destination: target.exe,
      signal: controller.signal,
      // Chromium's stack: system proxy, system certificates, same redirect
      // behaviour as a browser. Node's fetch ignores proxy settings entirely.
      request: (input, init) => net.fetch(input, init as never),
      onProgress: (progress) => {
        set(id, {
          state: 'downloading',
          received: progress.received,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond,
          percent: progress.total > 0 ? Math.min(99, Math.round((progress.received / progress.total) * 100)) : 0
        })
      }
    })

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
    if (controller.signal.aborted) {
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
          : 'The download could not be completed. Check the connection and try again.'
    })
    return stateOf(id)
  } finally {
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
