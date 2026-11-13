/*
 * Where the app's files go, given what somebody chose.
 *
 * One rule, used by both sides: the window (to show the real folder before
 * anything happens) and the main process (because it is the one that has to be
 * right). It loads as a CommonJS module in the main process and as a plain
 * script in the page, so there is exactly one implementation to get wrong.
 *
 * The rule exists because of a real bug: choosing "Desktop" made the installer
 * put a hundred loose files on the Desktop, because NSIS takes an install path
 * literally. Choosing a place to install to means "put the app here", not
 * "spread the app across here" — so unless the path already ends in the app's
 * own folder, one is appended.
 */
;(function attach(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.IndraFolder = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function build() {
  const APP_FOLDER = 'INDRA HUB'

  /**
   * `C:\Users\A\Desktop` → `C:\Users\A\Desktop\INDRA HUB`
   * `C:\Apps\INDRA HUB`  → unchanged (case-insensitive)
   * A trailing separator is ignored; an empty value stays empty.
   */
  function ensureAppFolder(value) {
    const raw = String(value ?? '').trim()
    if (!raw) return ''
    const trimmed = raw.replace(/[\\/]+$/, '')
    if (!trimmed) return raw
    const last = trimmed.split(/[\\/]/).pop()
    if (last.toLowerCase() === APP_FOLDER.toLowerCase()) return trimmed
    const separator = trimmed.includes('\\') ? '\\' : '/'
    return `${trimmed}${separator}${APP_FOLDER}`
  }

  return { APP_FOLDER, ensureAppFolder }
})
