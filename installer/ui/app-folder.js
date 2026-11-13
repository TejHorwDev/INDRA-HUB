/*
 * The install-folder rules, in one place.
 *
 * The window shows them as you type and the main process enforces them before
 * it hands a path to NSIS, so a path that looks fine and a path that installs
 * fine are decided by the same code. Two copies of this drifted once and the
 * page ended up calling a function nobody had defined; everything looked right
 * and nothing worked.
 *
 * Loaded as a CommonJS module in the main process and as a plain script in the
 * page.
 */
;(function attach(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.IndraFolder = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function build() {
  const APP_FOLDER = 'INDRA HUB'
  const INVALID_CHARS = /[<>:"|?*\u0000-\u001f]/
  const MAX_LENGTH = 170

  const RESERVED = [
    'c:\\windows',
    'c:\\windows\\system32',
    'c:\\program files',
    'c:\\program files (x86)',
    'c:\\programdata',
    'c:\\users',
    'c:\\users\\public'
  ]

  /**
   * `C:\Users\A\Desktop` → `C:\Users\A\Desktop\INDRA HUB`
   * `C:\Apps\INDRA HUB`  → unchanged (case-insensitive)
   * A trailing separator is ignored; an empty value stays empty.
   *
   * Choosing a place to install to means "put the app here", not "spread the
   * app across here" — without this, picking the Desktop put a hundred loose
   * files on it.
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

  /** The reason a folder cannot be used, or null when it can. */
  function pathProblem(value) {
    const raw = String(value ?? '').trim()
    if (!raw) return 'Choose an install folder.'
    if (!/^[a-zA-Z]:[\\/]/.test(raw)) {
      return 'Use a full Windows path, like C:\\INDRA HUB.'
    }
    if (raw.length > MAX_LENGTH) return 'That path is too long.'
    if (INVALID_CHARS.test(raw.slice(2))) {
      return 'A folder name cannot contain < > : " | ? *'
    }

    const settled = raw.replace(/[\\/]+$/, '').toLowerCase()
    if (settled.length <= 2) return 'Choose a folder inside the drive, not the drive itself.'
    if (RESERVED.includes(settled) || settled.startsWith('c:\\windows')) {
      return 'Choose a folder for the app, not a system folder.'
    }
    return null
  }

  return { APP_FOLDER, MAX_LENGTH, INVALID_CHARS, RESERVED, ensureAppFolder, pathProblem }
})
