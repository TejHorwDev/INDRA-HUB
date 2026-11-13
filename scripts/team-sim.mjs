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
export * from ${JSON.stringify(join(root, 'src/main/lib/validation.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/projects.ts'))}
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

  /* ---- 4. finding someone is by email, and shows the name ---------- */
  const found = api.searchTeamCandidates(owner, 'sita@example.test')
  check(found.length === 1 && found[0].id === stranger.id, 'an exact email finds the account')
  check(found[0].displayName === 'Sita Magar', 'and the answer carries their name', found[0].displayName)
  check(found[0].email === 'sita@example.test', 'and the address that matched')
  check(
    api.searchTeamCandidates(owner, 'SITA@Example.Test').length === 1,
    'the address is matched without regard to case'
  )

  check(
    api.searchTeamCandidates(owner, 'sita').length === 0 && api.searchTeamCandidates(owner, 'Sita Gurung').length === 0,
    'a name or its beginning finds nothing — names repeat, so they never search'
  )
  check(
    api.searchTeamCandidates(owner, 'sita@example').length === 0,
    'a partial address is not a match either'
  )
  check(
    api.searchTeamCandidates(owner, 'nobody@example.test').length === 0,
    'an address nobody registered returns nothing'
  )
  check(
    api.searchTeamCandidates(owner, 'bikash@example.test').every((person) => person.id !== mate.id),
    'the address of somebody already on the roster is not offered'
  )
  check(
    api.searchTeamCandidates(owner, 'asha@example.test').every((person) => person.id !== owner.id),
    'and the owner cannot add themselves'
  )
  check(api.searchTeamCandidates(owner, '').length === 0, 'an empty query searches for nothing')
  check(
    refused(() => api.validateEmailQuery('sita')).length > 0,
    'a query that is not an address is refused before it reaches the table'
  )

  /* ---- 4b. the same rule when adding to a project ------------------ */
  const project = api.createProject(owner, { name: 'The studio project' })
  const onProject = api.searchUsers('sita@example.test', project.id)
  check(onProject.length === 1 && onProject[0].id === stranger.id, 'a project finds people by email too')
  check(onProject[0].displayName === 'Sita Magar', 'and shows the name before anybody is added', onProject[0].displayName)
  check(
    api.searchUsers('sita', project.id).length === 0,
    'a project does not search by name either'
  )
  api.addMember(owner, project.id, stranger.id)
  check(
    api.searchUsers('sita@example.test', project.id).length === 0,
    'and stops offering somebody who is already on the project'
  )
  check(
    api.searchUsers('asha@example.test', project.id).length === 0,
    'and never offers the head developer'
  )

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
