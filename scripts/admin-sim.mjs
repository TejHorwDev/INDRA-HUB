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

  if (admin.adminStatus().configured) {
    fail('a fresh database already reports an administrator')
    return
  }

  const created = admin.ensureBuiltInAdmin()
  if (!created || !admin.adminStatus().configured) {
    fail('the built-in administrator was not created')
    return
  }
  if (admin.ensureBuiltInAdmin()) {
    fail('a second administrator was created on the next start')
    return
  }

  try {
    const account = admin.adminSignIn({ email: EMAIL, password: PASSWORD })
    console.log(`✓ signed in as ${account.email}`)
  } catch (error) {
    fail(`the documented credentials were rejected: ${error?.message}`)
    return
  }

  for (const [label, input] of [
    ['a wrong password', { email: EMAIL, password: 'not-the-password' }],
    ['a different email', { email: 'someone@example.com', password: PASSWORD }]
  ]) {
    try {
      admin.adminSignIn(input)
      fail(`${label} was accepted`)
      return
    } catch {
      console.log(`✓ ${label} was refused`)
    }
  }

  // The ordinary Sign in screen must recognise the administrator too.
  const viaLogin = admin.signInAdminFromLogin({ identifier: EMAIL, password: PASSWORD })
  if (!viaLogin || viaLogin.email !== EMAIL) {
    fail('the administrator could not sign in from the ordinary sign-in screen')
    return
  }
  console.log('✓ recognised on the ordinary sign-in screen')

  admin.adminSignOut()
  if (admin.signInAdminFromLogin({ identifier: 'someone@example.com', password: PASSWORD })) {
    fail('a different email was recognised as the administrator')
    return
  }
  console.log('✓ not recognised for any other email')

  console.log('✓ one administrator, the documented credentials, no other way in')

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
