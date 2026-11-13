/**
 * Proves the team service: create, rename, roster, removal and the rules that
 * keep one person's team theirs.
 *
 * Teams are the first thing on the home screen and they are writable, so the
 * checks here are about authority rather than shape: a member of somebody
 * else's team can read it and cannot change it, an owner cannot be added to
 * their own roster, and deleting a team leaves every account intact.
 *
 *   npm run sim:team
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-team-sim')
const userData = join(work, 'userdata')

let failures = 0

function check(pass, label, detail) {
  if (pass) {
    console.log(`✓ ${label}`)
  } else {
    failures += 1
    console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

function refused(run) {
  try {
    run()
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
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
  getVersion: () => '1.7.0',
  getPath: () => ${JSON.stringify(userData)},
  relaunch: () => {},
  exit: () => {}
}
module.exports = { app, net: { fetch: () => { throw new Error('offline') } }, BrowserWindow: { getAllWindows: () => [] }, safeStorage: { isEncryptionAvailable: () => false } }
`
  )

  writeFileSync(
    join(work, 'entry.ts'),
    `export * from ${JSON.stringify(join(root, 'src/main/services/teams.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/auth.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/settings.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/users.ts'))}
`
  )

  await build({
    entryPoints: [join(work, 'entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'node:sqlite'],
    outfile: join(work, 'bundle.cjs'),
    logLevel: 'warning'
  })

  const api = createRequire(join(work, 'index.js'))(join(work, 'bundle.cjs'))

  const owner = api.register({
    username: 'owner',
    displayName: 'Asha Rai',
    email: 'asha@example.test',
    password: 'CorrectHorse9'
  })
  const mate = api.register({
    username: 'mate',
    displayName: 'Bikash Shah',
    email: 'bikash@example.test',
    password: 'CorrectHorse9'
  })
  const stranger = api.register({
    username: 'stranger',
    displayName: 'Sita Magar',
    email: 'sita@example.test',
    password: 'CorrectHorse9'
  })

  /* ---- 1. nothing exists until it is created ---------------------- */
  const before = api.teamOverview(owner)
  check(before.owned === null && before.memberOf.length === 0, 'a new account has no team')

  const team = api.createTeam(owner, { name: 'The studio' })
  check(team.name === 'The studio' && team.role === 'owner', 'the owner can create a team')
  check(team.memberCount === 1, 'the owner counts as the first member', String(team.memberCount))
  check(team.members[0].role === 'owner', 'the roster names the owner first')

  check(
    /already have a team/i.test(refused(() => api.createTeam(owner, { name: 'Another' }))),
    'a second team on one account is refused'
  )
  check(
    /name/i.test(refused(() => api.renameTeam(owner, { name: '   ' }))),
    'a blank team name is refused'
  )

  /* ---- 2. the roster ------------------------------------------------ */
  const added = api.addTeamMember(owner, mate.id)
  check(added.memberCount === 2, 'a member can be added', String(added.memberCount))
  check(
    added.members.some((member) => member.id === mate.id && member.role === 'member'),
    'the member appears on the roster as a member'
  )
  check(
    /already on the team/i.test(refused(() => api.addTeamMember(owner, mate.id))),
    'the same person cannot be added twice'
  )
  check(
    /own team/i.test(refused(() => api.addTeamMember(owner, owner.id))),
    'the owner cannot be added to their own roster'
  )
  check(
    /no longer exists/i.test(refused(() => api.addTeamMember(owner, 'nobody'))),
    'an unknown account is refused'
  )

  /* ---- 3. a member can see the team and cannot change it ----------- */
  const seenByMate = api.teamOverview(mate)
  check(seenByMate.owned === null, 'a member does not gain a team of their own')
  check(seenByMate.memberOf.length === 1, 'a member sees the team they belong to', String(seenByMate.memberOf.length))
  check(seenByMate.memberOf[0].role === 'member', 'and sees themselves as a member')
  check(
    seenByMate.memberOf[0].memberCount === 2,
    'and sees the whole roster',
    String(seenByMate.memberOf[0].memberCount)
  )

  check(
    /do not have a team/i.test(refused(() => api.renameTeam(mate, { name: 'Mine now' }))),
    'a member cannot rename somebody else’s team'
  )
  check(
    /do not have a team/i.test(refused(() => api.addTeamMember(mate, stranger.id))),
    'a member cannot add people to somebody else’s team'
  )
  check(
    /do not have a team/i.test(refused(() => api.removeTeamMember(mate, owner.id))),
    'a member cannot remove the owner'
  )
  check(api.teamOverview(owner).owned.name === 'The studio', 'the team is unchanged after those attempts')

  /* ---- 4. search offers only valid additions ----------------------- */
  const found = api.searchTeamCandidates(owner, 'si')
  check(found.length === 1 && found[0].id === stranger.id, 'search finds an account that could join')
  check(
    api.searchTeamCandidates(owner, 'bi').every((person) => person.id !== mate.id),
    'search never offers somebody already on the roster'
  )
  check(
    api.searchTeamCandidates(owner, 'as').every((person) => person.id !== owner.id),
    'search never offers the owner'
  )
  check(api.searchTeamCandidates(owner, 'a').length === 0, 'a single letter searches for nothing')

  /* ---- 5. removal and rename --------------------------------------- */
  const afterRemove = api.removeTeamMember(owner, mate.id)
  check(afterRemove.memberCount === 1, 'a member can be removed', String(afterRemove.memberCount))
  check(api.teamOverview(mate).memberOf.length === 0, 'and the team disappears from their home')
  check(
    /not on the team/i.test(refused(() => api.removeTeamMember(owner, mate.id))),
    'removing somebody twice is refused'
  )

  const renamed = api.renameTeam(owner, { name: '  The   Studio  ' })
  check(renamed.name === 'The Studio', 'renaming tidies the name', renamed.name)

  /* ---- 6. delete leaves the accounts alone ------------------------- */
  api.addTeamMember(owner, mate.id)
  const gone = api.deleteTeam(owner)
  check(gone.owned === null, 'the owner can delete the team')
  check(api.teamOverview(mate).memberOf.length === 0, 'the roster goes with it')
  check(api.findUserById(mate.id) !== null, 'the people are untouched', 'account missing')
  check(api.findUserById(owner.id) !== null, 'and so is the owner')

  const rebuilt = api.createTeam(owner)
  check(rebuilt.name === 'Asha’s team' || rebuilt.name === "Asha's team", 'a nameless team is named after its owner', rebuilt.name)

  console.log('')
  if (failures === 0) console.log('teams: all checks passed')
  if (failures > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
