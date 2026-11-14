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

export function exeName(name: string): string {
  const base = safeName(name.replace(/\.exe$/i, ''))
  return `${base}.exe`
}

/** The library: `%APPDATA%\INDRA LOADER\downloads`. */
export function libraryDir(userData: string): string {
  return join(userData, 'downloads')
}

export interface AppPaths {
  /** `…\INDRA LOADER\downloads\<name>` */
  dir: string
  /** `…\INDRA LOADER\downloads\<name>\<name>.exe` */
  exe: string
}

export function appPaths(library: string, name: string): AppPaths {
  const dir = join(library, safeName(name))
  return { dir, exe: join(dir, exeName(name)) }
}
