/**
 * Proves the team service, and the invitations it now depends on.
 *
 * Teams are writable, and they are about other people, so the checks here are
 * about consent and authority rather than shape: asking somebody does not put
 * them on the roster, answering somebody else's invitation is refused, a
 * declined question writes no membership, and only the owner of what was
 * offered can take the question back. The same rules are proved for project
 * membership, because it is the same table.
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
  getVersion: () => '1.9.3',
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
export * from ${JSON.stringify(join(root, 'src/main/services/invitations.ts'))}
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
  check(team.invitations.length === 0, 'and starts with nobody invited')

  check(
    /already have a team/i.test(refused(() => api.createTeam(owner, { name: 'Another' }))),
    'a second team on one account is refused'
  )
  check(
    /name/i.test(refused(() => api.renameTeam(owner, { name: '   ' }))),
    'a blank team name is refused'
  )

  /* ---- 2. asking is not joining ------------------------------------ */
  const invited = api.inviteTeamMember(owner, mate.id)
  check(invited.memberCount === 1, 'an invitation does not change the roster', String(invited.memberCount))
  check(
    invited.members.every((member) => member.id !== mate.id),
    'the invited person is not a member yet'
  )
  check(invited.invitations.length === 1, 'the owner sees one question waiting')
  const first = invited.invitations[0]
  check(first.kind === 'team' && first.targetName === 'The studio', 'the invitation names the team')
  check(first.displayName === 'Bikash Shah', 'and carries the invited person’s name', first.displayName)
  check(first.email === 'bikash@example.test', 'and the address that was used', first.email)
  check(first.invitedByName === 'Asha Rai', 'and who asked', first.invitedByName)

  check(
    /already been invited/i.test(refused(() => api.inviteTeamMember(owner, mate.id))),
    'the same person cannot be asked twice while it is pending'
  )
  check(
    /own team/i.test(refused(() => api.inviteTeamMember(owner, owner.id))),
    'the owner cannot invite themselves'
  )
  check(
    /no longer exists/i.test(refused(() => api.inviteTeamMember(owner, 'nobody'))),
    'an unknown account is refused'
  )
  check(
    /No account uses/i.test(refused(() => api.inviteTeamMember(owner, 'nobody@example.test'))),
    'an address nobody registered is refused by address'
  )

  const invitedByEmail = api.teamOverview(owner).owned.invitations
  check(
    invitedByEmail.length === 1 && invitedByEmail[0].personId === mate.id,
    'inviting by address reaches the same account'
  )

  /* ---- 3. the invitee is told, and can answer ---------------------- */
  const seen = api.myInvitations(mate)
  check(seen.length === 1, 'the invitation reaches the person it names', String(seen.length))
  check(seen[0].kind === 'team' && seen[0].targetName === 'The studio', 'with what it is for')
  check(api.teamOverview(mate).memberOf.length === 0, 'but nothing has joined them yet')

  check(
    /not addressed to you/i.test(refused(() => api.respond(stranger, seen[0].id, true))),
    'nobody else can answer an invitation'
  )
  check(
    /Only the owner/i.test(refused(() => api.revoke(mate, seen[0].id))),
    'and the person invited cannot withdraw the question themselves — only decline it'
  )

  const answered = api.respond(mate, seen[0].id, true)
  check(answered.accepted === true, 'accepting says yes')
  check(answered.targetName === 'The studio', 'and names what they joined')

  const afterAccept = api.teamOverview(mate)
  check(afterAccept.memberOf.length === 1, 'accepting puts them on the roster', String(afterAccept.memberOf.length))
  check(afterAccept.memberOf[0].role === 'member', 'as a member, not an owner')
  check(afterAccept.memberOf[0].memberCount === 2, 'and the roster counts them')
  check(
    !afterAccept.memberOf[0].members.some((member) => member.role === 'owner' && member.id === mate.id),
    'the owner stays the owner'
  )
  check(api.myInvitations(mate).length === 0, 'and the question leaves their Home')
  check(
    api.teamOverview(owner).owned.invitations.length === 0,
    'and leaves the owner’s list of questions'
  )
  check(
    /already been answered/i.test(refused(() => api.respond(mate, seen[0].id, true))),
    'the same invitation cannot be answered twice'
  )
  check(
    /already on the team|already been invited/i.test(
      refused(() => api.inviteTeamMember(owner, mate.id))
    ),
    'and a member cannot be invited again'
  )

  /* ---- 4. declining is an answer too ------------------------------- */
  const askedSita = api.inviteTeamMember(owner, 'sita@example.test')
  check(askedSita.invitations.length === 1, 'a second person can be asked')
  check(
    api.searchTeamCandidates(owner, 'sita@example.test').length === 0,
    'somebody already asked is not offered again by search'
  )

  const sitaInbox = api.myInvitations(stranger)
  const declined = api.respond(stranger, sitaInbox[0].id, false)
  check(declined.accepted === false, 'declining says no')
  check(api.teamOverview(stranger).memberOf.length === 0, 'and writes no membership')
  check(
    api.teamOverview(owner).owned.invitations.length === 0,
    'the owner is not left waiting on a question that was answered'
  )
  check(
    api.teamOverview(owner).owned.memberCount === 2,
    'and the roster is exactly the people who accepted',
    String(api.teamOverview(owner).owned.memberCount)
  )
  check(
    /already been answered/i.test(refused(() => api.respond(stranger, sitaInbox[0].id, true))),
    'a declined invitation cannot be accepted afterwards'
  )
  check(
    api.inviteTeamMember(owner, 'sita@example.test').invitations.length === 1,
    'a new invitation can be sent after a decline'
  )

  /* ---- 5. the owner can take a question back ----------------------- */
  const takeBack = api.teamOverview(owner).owned.invitations[0]
  check(
    /Only the owner/i.test(refused(() => api.revoke(mate, takeBack.id))),
    'only the owner can take an invitation back'
  )
  api.revoke(owner, takeBack.id)
  check(
    api.teamOverview(owner).owned.invitations.length === 0,
    'a revoked question leaves the owner’s list'
  )
  check(api.myInvitations(stranger).length === 0, 'and the invitee’s Home')
  check(
    /already been answered/i.test(refused(() => api.respond(stranger, takeBack.id, true))),
    'a revoked invitation can no longer be accepted'
  )
  check(api.teamOverview(stranger).memberOf.length === 0, 'and a revoked invitation joins nobody')

  /* ---- 6. authority over the team itself --------------------------- */
  check(
    /do not have a team/i.test(refused(() => api.renameTeam(mate, { name: 'Mine now' }))),
    'a member cannot rename somebody else’s team'
  )
  check(
    /do not have a team/i.test(refused(() => api.inviteTeamMember(mate, stranger.id))),
    'a member cannot invite people to somebody else’s team'
  )
  check(
    /do not have a team/i.test(refused(() => api.removeTeamMember(mate, owner.id))),
    'a member cannot remove the owner'
  )
  check(api.teamOverview(owner).owned.name === 'The studio', 'the team is unchanged after those attempts')

  /* ---- 7. finding someone is by email, and shows the name ---------- */
  const found = api.searchTeamCandidates(owner, 'sita@example.test')
  check(found.length === 1 && found[0].id === stranger.id, 'an exact email finds the account')
  check(found[0].displayName === 'Sita Magar', 'and the answer carries their name', found[0].displayName)
  check(found[0].email === 'sita@example.test', 'and the address that matched')
  check(
    api.searchTeamCandidates(owner, 'SITA@Example.Test').length === 1,
    'the address is matched without regard to case'
  )
  check(
    api.searchTeamCandidates(owner, 'sita').length === 0 &&
      api.searchTeamCandidates(owner, 'Sita Gurung').length === 0,
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
    'and the owner cannot invite themselves'
  )
  check(api.searchTeamCandidates(owner, '').length === 0, 'an empty query searches for nothing')
  check(
    refused(() => api.validateEmailQuery('sita')).length > 0,
    'a query that is not an address is refused before it reaches the table'
  )

  /* ---- 8. the same rules for project membership -------------------- */
  const project = api.createProject(owner, { name: 'The studio project' })
  // The team is a standing yes: a new project already has the team inside it.
  check(
    project.members.length === 1 && project.members[0].via === 'team',
    'a new project opens to the owner’s team',
    String(project.members.length)
  )
  check(
    project.memberCount === 1,
    'and counts them without an invitation',
    String(project.memberCount)
  )
  check(
    api.searchUsers('bikash@example.test', project.id).length === 0,
    'a team member is not offered for an invitation they do not need'
  )
  check(
    /already work in this project/i.test(refused(() => api.inviteMember(owner, project.id, mate.id))),
    'and inviting them is refused with the reason'
  )
  check(
    api.listProjects(mate).some((entry) => entry.id === project.id && entry.via === 'team'),
    'while the project appears for them, through the team'
  )

  const onProject = api.searchUsers('sita@example.test', project.id)
  check(onProject.length === 1 && onProject[0].id === stranger.id, 'a project finds people by email too')
  check(
    onProject[0].displayName === 'Sita Magar',
    'and shows the name before anybody is invited',
    onProject[0].displayName
  )
  check(api.searchUsers('sita', project.id).length === 0, 'a project does not search by name either')
  check(
    api.searchUsers('asha@example.test', project.id).length === 0,
    'and never offers the head developer'
  )

  const projectInvite = api.inviteMember(owner, project.id, stranger.id)
  check(
    projectInvite.members.length === 1,
    'inviting somebody outside the team does not add them to the project',
    String(projectInvite.members.length)
  )
  check(
    projectInvite.memberCount === 1,
    'the project count stays people with access',
    String(projectInvite.memberCount)
  )
  check(projectInvite.invitations.length === 1, 'the head developer sees the question waiting')
  check(
    projectInvite.invitations[0].kind === 'project' &&
      projectInvite.invitations[0].targetName === 'The studio project',
    'and it names the project'
  )
  check(
    api.searchUsers('sita@example.test', project.id).length === 0,
    'somebody already asked is not offered again by project search'
  )
  check(
    /already been invited/i.test(refused(() => api.inviteMember(owner, project.id, stranger.id))),
    'and asking twice is refused'
  )
  check(
    /already on this project/i.test(refused(() => api.inviteMember(owner, project.id, owner.id))),
    'the head developer cannot invite themselves'
  )

  const projectInbox = api.myInvitations(stranger)
  check(projectInbox.length === 1, 'the invitee sees the project question')
  check(projectInbox[0].kind === 'project', 'as a project invitation')
  const joined = api.respond(stranger, projectInbox[0].id, true)
  check(joined.accepted === true, 'accepting the project invitation says yes')
  const projectAfter = api.getProject(owner, project.id)
  check(
    projectAfter.members.length === 2,
    'and the person is on the project',
    String(projectAfter.members.length)
  )
  check(
    projectAfter.members.some((member) => member.userId === stranger.id && member.via === 'invite'),
    'as the person who accepted'
  )
  check(api.getProject(owner, project.id).invitations.length === 0, 'with no question left over')

  check(
    /Only the head developer/i.test(
      refused(() => api.inviteMember(stranger, project.id, mate.id))
    ),
    'a member cannot invite people to the project'
  )

  /* ---- 9. removal, rename, delete --------------------------------- */
  const afterRemove = api.removeTeamMember(owner, mate.id)
  check(afterRemove.memberCount === 1, 'a member can be removed', String(afterRemove.memberCount))
  check(api.teamOverview(mate).memberOf.length === 0, 'and the team disappears from their home')
  check(
    /not on the team/i.test(refused(() => api.removeTeamMember(owner, mate.id))),
    'removing somebody twice is refused'
  )
  check(
    api.inviteTeamMember(owner, mate.id).invitations.length === 1,
    'somebody removed can be invited again'
  )
  api.revoke(owner, api.teamOverview(owner).owned.invitations[0].id)

  const renamed = api.renameTeam(owner, { name: '  The   Studio  ' })
  check(renamed.name === 'The Studio', 'renaming tidies the name', renamed.name)

  /* ---- 10. delete leaves the accounts alone ----------------------- */
  api.inviteTeamMember(owner, mate.id)
  check(api.myInvitations(mate).length === 1, 'a question is waiting before the delete')
  const gone = api.deleteTeam(owner)
  check(gone.owned === null, 'the owner can delete the team')
  check(api.teamOverview(mate).memberOf.length === 0, 'the roster goes with it')
  check(api.myInvitations(mate).length === 0, 'and so do the questions it left open')
  check(api.findUserById(mate.id) !== null, 'the people are untouched', 'account missing')
  check(api.findUserById(owner.id) !== null, 'and so is the owner')

  const rebuilt = api.createTeam(owner)
  check(
    rebuilt.name === 'Asha’s team' || rebuilt.name === "Asha's team",
    'a nameless team is named after its owner',
    rebuilt.name
  )

  console.log('')
  if (failures === 0) console.log('teams: all checks passed')
  if (failures > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
