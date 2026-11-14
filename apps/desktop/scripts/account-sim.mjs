/**
 * Proves the INDRA account path without a window and without a network.
 *
 * A small Supabase stands in for the real project: GoTrue for sign-up, sign-in,
 * refresh and logout, PostgREST for the profile row. The real `account.ts`,
 * `accountSession.ts` and `auth.ts` are bundled and pointed at it, so what is
 * tested is the code that ships.
 *
 * What this checks:
 *   1. a local account can be turned into an INDRA account, and keeps its work
 *   2. no password is stored anywhere afterwards — only a sealed session
 *   3. the refresh token is exchanged, not the password replayed
 *   4. a wrong password is an ordinary refusal, not a half-created session
 *   5. offline, sign-in is refused and an existing session survives
 *   6. signing out clears the sealed session and the app session
 *   7. a second PC signs in to the same profile and gets its own mirror
 *
 *   npm run sim:account
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-account-sim')
const bundlePath = join(work, 'bundle.js')

let failures = 0
const ok = (message) => console.log(`✓ ${message}`)
const fail = (message) => {
  failures += 1
  console.error(`\n✗ ${message}`)
  process.exitCode = 1
}
const check = (condition, message, detail = '') => {
  if (condition) ok(message)
  else fail(`${message}${detail ? ` — ${detail}` : ''}`)
}

const refused = async (run) => {
  try {
    await run()
    return ''
  } catch (error) {
    return error?.message ?? String(error)
  }
}

const PASSWORD = 'CorrectHorse9'
const EMAIL = 'asha@example.test'
const AUTH_UID = '11111111-2222-3333-4444-555555555555'
const PROFILE_ID = 'profile-asha'

/* ------------------------------------------------------------------ */
/* A small, faithful Supabase                                          */
/* ------------------------------------------------------------------ */

const server = {
  tokens: new Map(),
  /** email -> password, the only thing the fake auth server knows. */
  accounts: new Map(),
  profile: {
    id: PROFILE_ID,
    username: 'asha',
    display_name: 'Asha Rai',
    member_no: 'IH-2026-000001',
    role: 'member',
    suspended_at: null
  },
  calls: [],
  online: true,
  refreshed: 0,
  issued: 0
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function session() {
  server.issued += 1
  const access = `access-${server.issued}`
  const refresh = `refresh-${server.issued}`
  server.tokens.set(access, AUTH_UID)
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: 3600,
    user: { id: AUTH_UID, email: EMAIL }
  }
}

async function handle(url, init = {}) {
  const method = (init.method ?? 'GET').toUpperCase()
  const body = init.body ? JSON.parse(init.body) : undefined
  server.calls.push({ url, method, body })

  if (url.includes('/auth/v1/signup')) {
    if (server.accounts.has(body?.email)) return json({ msg: 'User already registered' }, 422)
    server.accounts.set(body.email, body.password)
    return json(session())
  }

  if (url.includes('/auth/v1/token?grant_type=password')) {
    if (server.accounts.get(body?.email) !== body?.password) {
      return json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400)
    }
    return json(session())
  }

  if (url.includes('/auth/v1/token?grant_type=refresh_token')) {
    if (!String(body?.refresh_token ?? '').startsWith('refresh-')) {
      return json({ error: 'invalid_grant' }, 400)
    }
    server.refreshed += 1
    return json(session())
  }

  if (url.includes('/auth/v1/logout')) return new Response(null, { status: 204 })

  if (url.includes('/rest/v1/rpc/indra_ensure_profile')) return json(server.profile)

  if (url.includes('/rest/v1/indra_users')) return new Response(null, { status: 204 })

  return json({ message: `unhandled ${method} ${url}` }, 404)
}

/* ------------------------------------------------------------------ */
/* The harness                                                         */
/* ------------------------------------------------------------------ */

async function main() {
  rmSync(work, { recursive: true, force: true })
  mkdirSync(join(work, 'node_modules', 'electron'), { recursive: true })

  writeFileSync(
    join(work, 'node_modules', 'electron', 'package.json'),
    JSON.stringify({ name: 'electron', version: '45.0.0', main: 'index.js' })
  )

  writeFileSync(
    join(work, 'node_modules', 'electron', 'index.js'),
    `const app = {
  isPackaged: true,
  getVersion: () => '3.0.0',
  getPath: () => globalThis.__userData,
  relaunch: () => {},
  exit: () => {}
}
const net = {
  isOnline: () => globalThis.__online !== false,
  fetch: async (url, init) => {
    if (globalThis.__online === false) throw new Error('offline')
    return globalThis.__accountServer.handle(String(url), init)
  }
}
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) =>
    Buffer.from(Buffer.from(value, 'utf8').toString('base64').split('').reverse().join(''), 'utf8'),
  decryptString: (buffer) =>
    Buffer.from(buffer.toString('utf8').split('').reverse().join(''), 'base64').toString('utf8')
}
const dialog = { showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: true }) }
const BrowserWindow = { getAllWindows: () => [], fromWebContents: () => null }
module.exports = { app, net, safeStorage, dialog, BrowserWindow,
  nativeTheme: { shouldUseDarkColors: true, on: () => {} },
  shell: { openExternal: () => {} },
  ipcMain: { handle: () => {} } }
`
  )

  writeFileSync(
    join(work, 'entry.ts'),
    `export * from ${JSON.stringify(join(root, 'src/main/services/account.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/lib/accountSession.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/auth.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/projects.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/connectivity.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/db/database.ts'))}
`
  )

  await build({
    entryPoints: [join(work, 'entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'node:sqlite'],
    outfile: bundlePath,
    logLevel: 'warning'
  })

  const require = createRequire(join(work, 'index.js'))
  require('electron')
  globalThis.__online = true
  globalThis.__accountServer = {
    handle: (url, init) => (server.online ? handle(url, init) : Promise.reject(new Error('offline')))
  }

  /** A separate installation: its own database, its own sealed session. */
  function boot(name) {
    globalThis.__userData = join(work, name)
    mkdirSync(globalThis.__userData, { recursive: true })
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(work) && !key.includes('node_modules')) delete require.cache[key]
    }
    server.calls.length = 0
    server.refreshed = 0
    return require(bundlePath)
  }

  /* ---- PC one: a local account with work, then connected ---------- */
  let api = boot('pc-one')

  const local = api.register({
    username: 'asha',
    displayName: 'Asha Rai',
    email: EMAIL,
    password: PASSWORD
  })
  const project = api.createProject(local, { name: 'The studio', description: 'Autumn work' })

  const before = api.currentAccountState()
  check(before.connected === false, 'a fresh installation is not connected to an INDRA account')
  check(before.profileId === null, 'and has no server profile')

  const created = await api.createAccountFromLocal(PASSWORD)
  check(created.state.connected === true, 'the local account becomes an INDRA account')
  check(created.state.profileId === PROFILE_ID, 'keyed on the server profile', created.state.profileId)
  check(created.state.memberNo === 'IH-2026-000001', 'with the member number the server minted')
  check(created.user.id === local.id, 'the local account is adopted, not replaced', created.user.id)
  check(
    api.listProjects(created.user).some((entry) => entry.id === project.id),
    'so the work already on this PC is still there'
  )

  const signupCall = server.calls.find((call) => call.url.includes('/auth/v1/signup'))
  check(signupCall?.body?.email === EMAIL, 'the server account uses the address of this PC’s account')
  check(
    signupCall?.body?.data?.full_name === 'Asha Rai',
    'and carries the display name the profile starts from'
  )

  /*
   * ---- a new account is created on the server, in the same act -------
   *
   * Registration used to stop at the local database; the server half was a
   * separate button nobody had to press. An account that exists only on one PC
   * is the trap this project kept falling into, so there is a check for it now.
   */
  const fresh = boot('pc-fresh')
  server.accounts.delete('newcomer@example.com')
  const made = await fresh.registerOnServer({
    username: 'newcomer',
    displayName: 'New Comer',
    email: 'newcomer@example.com',
    password: 'correct-horse'
  })
  check(made.email === 'newcomer@example.com', 'creating an account returns that account')
  check(fresh.currentAccountState().connected === true, 'and it is signed in to the server at once')
  check(
    server.calls.some((call) => call.url.includes('/auth/v1/signup') && call.body?.email === 'newcomer@example.com'),
    'the server really received the account, not just this PC'
  )

  /* And when the server refuses, the local half does not survive. */
  server.accounts.set('taken@example.com', 'whatever')
  const before2 = fresh
    .getDatabase()
    .prepare('SELECT COUNT(*) AS n FROM users')
    .get().n
  let refusal = null
  try {
    await fresh.registerOnServer({
      username: 'taken',
      displayName: 'Taken',
      email: 'taken@example.com',
      password: 'correct-horse'
    })
  } catch (error) {
    refusal = error
  }
  check(refusal !== null, 'a refused registration reports the refusal')
  const after2 = fresh
    .getDatabase()
    .prepare('SELECT COUNT(*) AS n FROM users')
    .get().n
  check(after2 === before2, 'and leaves no account that only exists on this PC', `${before2} → ${after2}`)

  /* ---- nothing at rest holds the password or a readable token ----- */
  const stored = api
    .getDatabase()
    .prepare("SELECT value FROM app_settings WHERE key = 'indra_account_session'")
    .get()
  const blob = stored?.value ?? ''
  check(blob.startsWith('enc:v1:'), 'the session is sealed by the keystore', blob.slice(0, 8))
  check(!blob.includes(PASSWORD), 'the password is not in the sealed session')
  check(!blob.includes('refresh-'), 'nor is the refresh token readable')

  const tables = api
    .getDatabase()
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
  let leaks = 0
  for (const table of tables) {
    const rows = api.getDatabase().prepare(`SELECT * FROM "${table.name}"`).all()
    if (JSON.stringify(rows).includes(PASSWORD)) leaks += 1
  }
  check(leaks === 0, 'no table anywhere stores the password', `${leaks} table(s)`)

  const hash = api
    .getDatabase()
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .get(local.id)
  check(hash?.password_hash !== PASSWORD, 'the local row still holds a hash, never the password')

  /* ---- 3. the session is renewed by token, not by password -------- */
  api.patchAccount({ expiresAt: Date.now() - 1000 })
  const live = await api.liveAccount()
  check(live.accessToken !== '', 'an expired session is renewed')
  check(server.refreshed === 1, 'by exchanging the refresh token', String(server.refreshed))
  const reused = server.calls.filter(
    (call) => call.url.includes('grant_type=password') && call !== signupCall
  )
  check(reused.length === 0, 'without replaying the password')

  /* ---- 4. a wrong password is refused cleanly --------------------- */
  const wrong = await refused(() =>
    api.signInAccount({ email: EMAIL, password: 'not-the-password' })
  )
  check(/incorrect/i.test(wrong), 'a wrong password is refused in plain words', wrong)
  check(api.currentAccountState().connected === true, 'and the existing session is untouched')

  /* ---- 5. offline: refused, and the session survives -------------- */
  const stillThere = api.readAccount()
  globalThis.__online = false
  const offlineError = await refused(() => api.signInAccount({ email: EMAIL, password: PASSWORD }))
  check(/connection|offline/i.test(offlineError), 'offline, signing in is refused', offlineError)
  check(
    api.readAccount()?.uid === stillThere?.uid,
    'and the sealed session is still the one it was'
  )
  globalThis.__online = true

  /* ---- 6. signing out clears both sessions ------------------------ */
  await api.signOutOfAccount()
  check(api.currentAccountState().connected === false, 'signing out clears the INDRA session')
  check(api.currentUser() === null, 'and closes the app session with it')
  const afterSignOut = api
    .getDatabase()
    .prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key = 'indra_account_session'")
    .get()
  check(Number(afterSignOut?.n) === 0, 'nothing is left on disk to replay')

  /* ---- 7. a second PC signs in to the same person ----------------- */
  api = boot('pc-two')
  check(api.currentAccountState().connected === false, 'the second PC starts signed out')

  const signedIn = await api.signInAccount({ email: EMAIL, password: PASSWORD })
  check(signedIn.state.connected === true, 'it signs in with the same email and password')
  check(
    signedIn.state.profileId === PROFILE_ID,
    'and resolves to the same server profile',
    signedIn.state.profileId
  )
  check(
    signedIn.user.email === EMAIL && signedIn.user.displayName === 'Asha Rai',
    'the local mirror is created from the server profile',
    `${signedIn.user.email} / ${signedIn.user.displayName}`
  )
  check(
    api.getDatabase().prepare('SELECT auth_user_id FROM users WHERE id = ?').get(signedIn.user.id)
      ?.auth_user_id === AUTH_UID,
    'and is bound to the auth user, not to the machine'
  )

  const pcOne = boot('pc-one')
  check(
    pcOne.getDatabase().prepare('SELECT auth_user_id FROM users WHERE id = ?').get(local.id)
      ?.auth_user_id === AUTH_UID,
    'the first PC still points at the same auth user'
  )
  check(
    existsSync(join(work, 'pc-one')) && existsSync(join(work, 'pc-two')),
    'two installations, one account'
  )

  dirsCleanup()
  console.log('')
  if (failures > 0) {
    console.error(`${failures} check(s) failed`)
    process.exitCode = 1
  } else {
    console.log('All account checks passed.')
  }
}

/** The database files are useful on failure, so they are only tidied on success. */
function dirsCleanup() {
  if (process.exitCode) return
  for (const entry of readdirSync(work)) {
    if (entry.startsWith('pc-')) rmSync(join(work, entry), { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
