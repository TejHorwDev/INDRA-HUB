import { join } from 'node:path'

/*
 * Where a downloaded application lives, and what it is called.
 *
 * One folder per product under `%APPDATA%\INDRA LOADER\downloads`, holding an
 * executable with the product's own name. It used to be `Documents\INDRA APPS`, which
 * scattered the loader's own files across a folder that belongs to the user — and left
 * the app unable to answer "what have I already downloaded?" without a second place to
 * look. Everything this app owns is now in the one folder it owns.
 *
 * Names come from a database an admin types into, so they are treated as hostile
 * input: every character Windows refuses in a file name becomes an underscore and
 * the result is capped at 60 characters. A product called `../../windows/system32`
 * therefore creates a folder with that name inside INDRA APPS, not outside it.
 */

const ILLEGAL = /[\\/:*?"<>|]/g
const MAX = 60

export function safeName(name: string): string {
  const cleaned = name
    .replace(ILLEGAL, '_')
    // Trailing dots and spaces are silently stripped by Windows, which turns two
    // different product names into one folder.
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, MAX)

  return cleaned || 'app'
}

/**
 * The executable's file name: `<Product> <version>.exe`.
 *
 * The version is in the name because a folder of executables with no versions in them is
 * a folder you cannot look at — and because two builds of one product can then sit side
 * by side for the second it takes to swap them, without one being written over the other
 * while it is still running.
 *
 * An empty version falls back to the bare product name, which is what every file
 * downloaded before this was called.
 */
export function exeName(name: string, version = ''): string {
  const base = safeName(name.replace(/\.exe$/i, '')).slice(0, 48)
  const tag = safeName(version.replace(/\s+/g, '_')).slice(0, 24)
  return tag ? `${base} ${tag}.exe` : `${base}.exe`
}

/** The library: `%APPDATA%\INDRA LOADER\downloads`. */
export function libraryDir(userData: string): string {
  return join(userData, 'downloads')
}

export interface AppPaths {
  /** `…\INDRA LOADER\downloads\<name>` */
  dir: string
  /** `…\INDRA LOADER\downloads\<name>\<name> <version>.exe` */
  exe: string
}

export function appPaths(library: string, name: string, version = ''): AppPaths {
  const dir = join(library, safeName(name))
  return { dir, exe: join(dir, exeName(name, version)) }
}
