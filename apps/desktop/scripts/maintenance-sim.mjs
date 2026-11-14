/**
 * Proves what maintenance mode does — and does not — close.
 *
 * The intent: the workspace is shut, but the front door stays open. People can
 * still sign in and register during maintenance (they simply arrive at the
 * maintenance screen), and every data call is still refused underneath, so a
 * renderer cannot talk its way past the switch.
 *
 *   npm run sim:maintenance
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-maintenance-sim')
const userData = join(work, 'userdata')

function fail(message) {
  console.error(`\n✗ ${message}`)
  process.exitCode = 1
}

async function main() {
  rmSync(work, { recursive: true, force: true })
  mkdirSync(userData, { recursive: true })

  mkdirSync(join(work, 'node_modules', 'electron'), { recursive: true })
  writeFileSync(
    join(work, 'node_modules', 'electron', 'package.json'),
    JSON.stringify({ name: 'electron', version: '45.0.0', main: 'index.js' })
  )
  writeFileSync(
    join(work, 'node_modules', 'electron', 'index.js'),
    `const app = {
  isPackaged: true,
  getVersion: () => '1.4.2',
  getPath: () => ${JSON.stringify(userData)},
  relaunch: () => {},
  exit: () => {}
}
module.exports = { app, net: { fetch: () => { throw new Error('offline') } }, BrowserWindow: { getAllWindows: () => [] } }
`
  )

  writeFileSync(
    join(work, 'entry.ts'),
    `export * from ${JSON.stringify(join(root, 'src/main/services/auth.ts'))}
export { readSettings, writeSettings } from ${JSON.stringify(join(root, 'src/main/services/settings.ts'))}
`
  )

  await build({
    entryPoints: [join(work, 'entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: join(work, 'auth.cjs'),
    logLevel: 'warning'
  })

  const auth = createRequire(join(work, 'index.js'))(join(work, 'auth.cjs'))

  const account = {
    username: 'tester',
    displayName: 'Tester',
    email: 'tester@example.com',
    password: 'Correct-Horse-2026!'
  }

  // 1. Registration and sign-in work while the app is open.
  auth.register(account)
  auth.signOut()
  auth.signIn({ identifier: 'tester', password: account.password })
  auth.signOut()
  console.log('✓ registration and sign-in work normally')

  // 2. The administrator closes the workspace.
  auth.writeSettings({
    allowRegistration: true,
    maintenanceMode: true,
    maintenanceMessage: 'Back in ten minutes.',
    requireActivationKey: false
  })

  try {
    auth.signIn({ identifier: 'tester', password: account.password })
    console.log('✓ sign-in still works during maintenance')
  } catch (error) {
    fail(`sign-in was refused during maintenance: ${error?.message}`)
    return
  }

  try {
    auth.requireUser()
    fail('a data call was allowed during maintenance')
    return
  } catch (error) {
    if (error?.code === 'MAINTENANCE') console.log('✓ data calls are refused during maintenance')
    else {
      fail(`unexpected error from a data call: ${error?.message}`)
      return
    }
  }

  auth.signOut()
  try {
    auth.register({ ...account, username: 'tester2', email: 'tester2@example.com' })
    console.log('✓ registration still works during maintenance')
  } catch (error) {
    fail(`registration was refused during maintenance: ${error?.message}`)
    return
  }

  // 3. Reopening clears it.
  auth.writeSettings({
    allowRegistration: true,
    maintenanceMode: false,
    maintenanceMessage: 'Back in ten minutes.',
    requireActivationKey: false
  })
  auth.signIn({ identifier: 'tester', password: account.password })
  auth.requireUser()
  console.log('✓ reopening restores the workspace')
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
