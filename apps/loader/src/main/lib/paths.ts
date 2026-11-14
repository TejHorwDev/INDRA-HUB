/*
 * Where a downloaded application lives, and what it is called.
 *
 * The rules are the ones the design fixes: a folder per product under
 * `Documents\INDRA APPS`, holding an executable with the product's own name.
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

export interface AppPaths {
  /** `…\Documents\INDRA APPS\<name>` */
  dir: string
  /** `…\Documents\INDRA APPS\<name>\<name>.exe` */
  exe: string
}

export function appPaths(documents: string, name: string): AppPaths {
  const folder = safeName(name)
  const dir = `${documents}\\INDRA APPS\\${folder}`
  return { dir, exe: `${dir}\\${exeName(name)}` }
}
