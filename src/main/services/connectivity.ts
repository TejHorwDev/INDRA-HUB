import { BrowserWindow, net } from 'electron'
import type { ConnectivityState } from '@shared/types'

/*
 * Connectivity.
 *
 * The app is local-first: every screen is served from SQLite, every document
 * and presentation is written there, and nothing has ever waited for the
 * network before it drew. That is why an unplugged PC keeps working — and it
 * is worth saying out loud, because the opposite assumption (a cloud app that
 * happens to cache) leads to a completely different design.
 *
 * What was missing was that the app did not *know*. This service answers
 * `net.isOnline()` — the operating system's own view of whether there is a
 * route out — and tells every window when the answer changes. It asks nothing
 * of the internet: no pings, no DNS, no traffic that would show up in a
 * network log or cost a metered connection anything.
 *
 * `net.isOnline()` is deliberately treated with a bias toward "online" if it
 * throws. A false offline would hide working features; a false online costs at
 * most a request that fails and is handled exactly as it was before this file
 * existed.
 */

const POLL_MS = 4_000

let online = true
let since = new Date().toISOString()
let timer: ReturnType<typeof setInterval> | null = null

function read(): boolean {
  try {
    return net.isOnline()
  } catch {
    return true
  }
}

export function connectivityState(): ConnectivityState {
  return { online, since }
}

export function isOnline(): boolean {
  return online
}

function publish(): void {
  const state = connectivityState()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('connectivity:changed', state)
  }
}

function refresh(): void {
  const next = read()
  if (next === online) return
  online = next
  since = new Date().toISOString()
  publish()
}

export function startConnectivity(): void {
  if (timer) return
  online = read()
  since = new Date().toISOString()
  timer = setInterval(refresh, POLL_MS)
  // A background timer must never be the reason the process stays alive.
  timer.unref?.()
}

export function stopConnectivity(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

/** Called when a window regains focus: the answer is worth re-reading then. */
export function recheckConnectivity(): ConnectivityState {
  refresh()
  return connectivityState()
}
