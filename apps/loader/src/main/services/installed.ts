import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appPaths, libraryDir } from '../lib/paths'

/*
 * What this machine has installed.
 *
 * A small file in userData, keyed by catalogue id: where the executable went and
 * what it was called when it was downloaded.
 *
 * It exists because launching must not depend on the network. If the catalogue
 * were consulted to translate an id back into a path, an offline machine — or an
 * API that is down — would not be able to start an application that is sitting
 * right there on disk, which is absurd.
 */

export interface InstalledApp {
  id: string
  name: string
  version: string
  /** Absolute path to the executable. */
  exe: string
  bytes: number
  downloadedAt: string
}

type Registry = Record<string, InstalledApp>

function file(): string {
  return join(app.getPath('userData'), 'installed.json')
}

export function readRegistry(): Registry {
  try {
    const parsed = JSON.parse(readFileSync(file(), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Registry
  } catch {
    return {}
  }
}

function write(registry: Registry): void {
  try {
    const path = file()
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify(registry, null, 2), 'utf8')
  } catch (error) {
    console.error('[installed] could not record', error)
  }
}

export function record(entry: InstalledApp): void {
  const registry = readRegistry()
  registry[entry.id] = entry
  write(registry)
}

export function forget(id: string): void {
  const registry = readRegistry()
  delete registry[id]
  write(registry)
}

/**
 * The recorded entry, but only while the executable is still there and still whole.
 *
 * This is the answer to "have I already downloaded this?", and it is answered from the
 * disk rather than from memory — because the whole point is surviving a restart, and a
 * file deleted (or truncated) in Explorer must bring the Download button back rather
 * than claim an app is ready to launch.
 */
export function installed(id: string): InstalledApp | null {
  const entry = readRegistry()[id]
  if (!entry || typeof entry.exe !== 'string') return null
  try {
    const info = statSync(entry.exe)
    if (!info.isFile()) return null
    // A recorded size that no longer matches means the file was replaced or cut short.
    if (entry.bytes > 0 && info.size !== entry.bytes) return null
    return entry
  } catch {
    return null
  }
}

/** Every recorded entry whose file is still on disk. */
export function allInstalled(): InstalledApp[] {
  return Object.keys(readRegistry())
    .map((id) => installed(id))
    .filter((entry): entry is InstalledApp => entry !== null)
}

/** Where a download for this name would go: inside the loader's own folder. */
export function downloadTarget(name: string): { dir: string; exe: string } {
  return appPaths(libraryDir(app.getPath('userData')), name)
}
