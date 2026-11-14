/**
 * Proves the shipped administrator works on a fresh installation.
 *
 * The account is created at startup, so a release that silently failed to seed
 * it would leave every new copy of the app with no way into the administration
 * area. This runs the real admin service against a throwaway database and signs
 * in with the documented credentials.
 *
 *   npm run sim:admin
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-admin-sim')
const userData = join(work, 'userdata')

const EMAIL = 'admintej@gmail.com'
const PASSWORD = 'AAaa1234@$'

function fail(message) {
  console.error(`\n✗ ${message}`)
  process.exitCode = 1
}

async function main() {
  rmSync(work, { recursive: true, force: true })
  mkdirSync(userData, { recursive: true })

  // An electron stand-in: the services only need a userData path.
  mkdirSync(join(work, 'node_modules', 'electron'), { recursive: true })
  writeFileSync(
    join(work, 'node_modules', 'electron', 'package.json'),
    JSON.stringify({ name: 'electron', version: '45.0.0', main: 'index.js' })
  )
  writeFileSync(
    join(work, 'node_modules', 'electron', 'index.js'),
    `const app = {
  isPackaged: true,
  getVersion: () => '1.4.0',
  getPath: () => ${JSON.stringify(userData)},
  relaunch: () => {},
  exit: () => {}
}
module.exports = { app, net: { fetch: () => { throw new Error('offline') } }, BrowserWindow: { getAllWindows: () => [] } }
`
  )

  await build({
    entryPoints: [join(root, 'src/main/services/admin.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: join(work, 'admin.cjs'),
    logLevel: 'warning'
  })

  const admin = createRequire(join(work, 'index.js'))(join(work, 'admin.cjs'))

  /*
   * No seeded administrator, and no way in without the server.
   *
   * The build used to create an administrator whose password was written into
   * it, so every installation shipped the same credential. The gate now asks
   * the server, which means: nothing on this PC to guess, and nothing to enter
   * when there is no route out.
   */
  const fresh = admin.adminStatus()
  if (fresh.admin !== null || fresh.signedIn) {
    fail('a fresh database already reports a signed-in administrator')
    return
  }
  if (fresh.configured !== true) {
    fail('the panel is not ready to be signed in to')
    return
  }
  console.log('✓ a fresh install has no administrator of its own — only a sign-in form')

  if (admin.ensureBuiltInAdmin()) {
    fail('a built-in administrator was still seeded')
    return
  }
  console.log('✓ and none is seeded, so no password is shared by every installation')

  /* This stub throws for every request: the machine has no route out. */
  let offlineRefusal = null
  try {
    await admin.adminSignIn({ email: EMAIL, password: PASSWORD })
  } catch (error) {
    offlineRefusal = error
  }
  if (!offlineRefusal) {
    fail('the panel signed somebody in without the server')
    return
  }
  console.log('✓ with no connection the gate refuses, rather than checking a local hash')

  const viaLogin = await admin.signInAdminFromLogin({ identifier: EMAIL, password: PASSWORD })
  if (viaLogin) {
    fail('the ordinary sign-in screen handed out an admin session offline')
    return
  }
  console.log('✓ the ordinary sign-in screen cannot hand out administration offline')

  let guarded = null
  try {
    admin.requireAdmin()
  } catch (error) {
    guarded = error
  }
  if (!guarded) {
    fail('admin data was readable without a session')
    return
  }
  console.log('✓ every admin call is refused without a session')

  console.log('✓ one administrator, decided by the server, with nothing to guess on this PC')

  /*
   * The packaged app's content policy. Two things on screen are drawn from Blob
   * URLs — the sign-in video and the About portrait — and a policy that omits
   * `blob:` blocks them in the installed build while dev, which has no such
   * header, shows them perfectly. That asymmetry is what made a shipped portrait
   * invisible with every other test still green, so the header is asserted here.
   */
  const main = readFileSync(join(root, 'src/main/index.ts'), 'utf8')
  // The directive list is a single string literal; comments sit above it.
  const policy =
    main
      .match(/'Content-Security-Policy'\s*:\s*\[[\s\S]*?default-src[^"]*"/)?.[0]
      ?.match(/"([^"]*default-src[^"]*)"/)?.[1] ?? ''
  if (!policy) {
    fail('the packaged app no longer sets a content security policy')
    return
  }
  const directive = (name) =>
    policy
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? ''

  if (directive('img-src').includes('blob:')) {
    console.log('✓ the packaged app may draw the portrait from a Blob URL')
  } else {
    fail(`img-src does not allow blob:, so the About portrait cannot be drawn — ${directive('img-src')}`)
  }
  if (directive('media-src').includes('blob:')) {
    console.log('✓ and may play the sign-in video from one')
  } else {
    fail(`media-src does not allow blob: — ${directive('media-src')}`)
  }
  if (!/script-src 'self'(\s|;|")/.test(policy) || dispute(policy)) {
    // Kept deliberately narrow: the point is that blob: was added, not that the
    // policy was loosened anywhere that could run code.
    fail(`script-src was loosened: ${directive('script-src')}`)
  } else {
    console.log('✓ without loosening script-src')
  }
}

/** True when the policy allows script from anything but itself. */
function dispute(policy) {
  const script = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('script-src '))
  return Boolean(script && /https?:|\*|'unsafe-eval'|blob:/.test(script))
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
