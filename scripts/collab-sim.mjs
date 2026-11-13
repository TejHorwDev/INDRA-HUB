/**
 * Proves that being invited actually means working together.
 *
 * The invitation is only the door. What this file checks is everything behind
 * it: that the person who accepted can find the project, open it, read what is
 * already there, write a document, turn a document into a deck, save that deck,
 * and see their own work where their colleague sees it. In both directions —
 * the owner must see the member's work as it happens, and the member must see
 * the owner's.
 *
 * It also checks the boundaries that keep this safe: a team membership is not
 * a project membership, only the head developer reshapes the team, and removing
 * someone actually removes their reach.
 *
 *   npm run sim:collab
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-collab-sim')
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
  getVersion: () => '1.9.4',
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
export * from ${JSON.stringify(join(root, 'src/main/services/documents.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/presentations.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/library.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/graph.ts'))}
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
  const outsider = api.register({
    username: 'outsider',
    displayName: 'Sita Magar',
    email: 'sita@example.test',
    password: 'CorrectHorse9'
  })

  /* ---- 1. the team is the standing yes ----------------------------- */
  const project = api.createProject(owner, { name: 'Research showcase' })
  const intro = api.createDocument(owner, project.id, 'Introduction')
  api.saveDocument(owner, project.id, intro.id, {
    baseVersion: 1,
    title: 'Introduction',
    blocks: [
      { id: 'b1', type: 'heading1', html: 'Why this matters' },
      { id: 'b2', type: 'paragraph', html: 'We studied what helps students present.' }
    ]
  })

  check(
    /not found/i.test(refused(() => api.getProject(mate, project.id))),
    'a stranger sees nothing before being asked'
  )

  api.createTeam(owner, { name: 'The studio' })
  api.inviteTeamMember(owner, mate.id)
  api.respond(mate, api.myInvitations(mate)[0].id, true)
  check(api.teamOverview(mate).memberOf.length === 1, 'the team invitation is accepted')

  /* ---- 2. joining the team opens the work -------------------------- */
  const mateProjects = api.listProjects(mate)
  check(
    mateProjects.some((entry) => entry.id === project.id),
    'the owner’s project appears for the new team member',
    String(mateProjects.length)
  )
  const summary = mateProjects.find((entry) => entry.id === project.id)
  check(summary.role === 'member', 'as a member', summary.role)
  check(summary.via === 'team', 'reached through the team', summary.via)

  const seen = api.getProject(mate, project.id)
  check(seen.name === 'Research showcase', 'the member can open the project', seen.name)
  check(seen.owner.displayName === 'Asha Rai', 'and sees who leads it')
  check(
    seen.members.some((member) => member.userId === mate.id && member.via === 'team'),
    'the project team list names them as team, not as an invite'
  )
  check(seen.team && seen.team.name === 'The studio', 'and the screen knows which team opens it')

  const ownerView = api.getProject(owner, project.id)
  check(ownerView.memberCount === 1, 'the owner sees one person with access', String(ownerView.memberCount))
  check(ownerView.members[0].displayName === 'Bikash Shah', 'by name, not by id')
  check(ownerView.team.memberCount === 1, 'and the team size behind it')

  /* ---- 3. the member opens what is already there -------------------- */
  const docs = api.listDocuments(mate, project.id)
  check(docs.length === 1 && docs[0].id === intro.id, 'the member sees the owner’s document')
  const opened = api.getDocument(mate, project.id, intro.id)
  check(opened.version === 2, 'at its current version', String(opened.version))
  check(opened.blocks.length === 2, 'with its content', String(opened.blocks.length))
  check(
    api.listLibraryDocuments(mate).some((item) => item.id === intro.id),
    'and it is in the member’s library too'
  )

  /* ---- 4. and writes in it ----------------------------------------- */
  const edited = api.saveDocument(mate, project.id, intro.id, {
    baseVersion: 2,
    blocks: [
      { id: 'b1', type: 'heading1', html: 'Why this matters' },
      { id: 'b2', type: 'paragraph', html: 'We studied what helps students present.' },
      { id: 'b3', type: 'paragraph', html: 'Bikash added the survey of 40 students.' }
    ]
  })
  check(edited.version === 3, 'the member’s edit becomes a new version', String(edited.version))
  check(edited.updatedBy?.displayName === 'Bikash Shah', 'attributed to the member')
  check(
    api.getDocument(owner, project.id, intro.id).blocks.length === 3,
    'and the owner sees the change'
  )

  const own = api.createDocument(mate, project.id, 'Survey notes')
  check(own.createdBy.displayName === 'Bikash Shah', 'a document the member creates is theirs')
  check(
    api.listDocuments(owner, project.id).some((document) => document.id === own.id),
    'and appears for the owner'
  )

  /* ---- 5. turns work into a deck ----------------------------------- */
  const deck = api.convertDocument(mate, project.id, intro.id)
  check(deck.slides.length > 0, 'a document becomes a deck for the member', String(deck.slides.length))
  check(
    api.listPresentations(owner, project.id).some((entry) => entry.id === deck.id),
    'and the owner sees the deck'
  )

  const savedDeck = api.savePresentation(mate, project.id, deck.id, {
    title: 'Research showcase — final',
    theme: 'editorial'
  })
  check(savedDeck.title === 'Research showcase — final', 'the member can rename the deck')
  check(savedDeck.theme === 'editorial', 'and change its theme')
  check(
    api.getPresentation(owner, project.id, deck.id).title === 'Research showcase — final',
    'and the owner sees both'
  )
  const blank = api.createBlankPresentation(mate, project.id, 'Rehearsal deck')
  check(blank.projectId === project.id, 'the member can start a blank deck in the project')
  check(
    api.listLibraryPresentations(owner).some((item) => item.id === deck.id),
    'and the deck is in the owner’s library'
  )

  /* ---- 6. the next project needs no invitation at all -------------- */
  const second = api.createProject(owner, { name: 'Final pitch' })
  check(
    api.listProjects(mate).some((entry) => entry.id === second.id),
    'a project created after the team joined opens to them too'
  )
  check(
    api.listDocuments(mate, second.id).length === 0,
    'and starts empty, as it should'
  )

  /* ---- 7. two people, one document --------------------------------- */
  check(
    /changed elsewhere/i.test(
      refused(() =>
        api.saveDocument(owner, project.id, intro.id, {
          baseVersion: 2,
          blocks: [{ id: 'b1', type: 'paragraph', html: 'stale write' }]
        })
      )
    ),
    'a stale save is refused rather than overwriting the member’s work'
  )
  check(
    api.getDocument(owner, project.id, intro.id).blocks.length === 3,
    'and the member’s work is intact'
  )

  /* ---- 8. asking a team member again is refused, kindly ------------ */
  check(
    /already work in this project/i.test(
      refused(() => api.inviteMember(owner, project.id, mate.id))
    ),
    'inviting somebody who is already on the team is refused with a reason'
  )
  check(
    api.searchUsers('bikash@example.test', project.id).length === 0,
    'and the project search does not offer them'
  )

  /* ---- 9. the shape of the project stays the owner’s --------------- */
  check(
    /only the head developer/i.test(refused(() => api.inviteMember(mate, project.id, outsider.id))),
    'a member cannot invite anybody into the project'
  )
  check(
    /only the head developer/i.test(refused(() => api.removeMember(mate, project.id, owner.id))),
    'a member cannot remove the head developer'
  )
  check(
    /on your team/i.test(refused(() => api.removeMember(owner, project.id, mate.id))),
    'team access is taken away through the team, not a project row'
  )

  /* ---- 10. the graph shows both ways in ---------------------------- */
  const graph = api.projectGraph(owner, project.id)
  check(graph.counts.members >= 1, 'the project graph counts the team member')
  check(
    graph.counts.documents >= 2,
    'and the documents both people wrote',
    String(graph.counts.documents)
  )

  /* ---- 11. somebody outside the team is invited, and removed ------- */
  check(
    /not found/i.test(refused(() => api.getProject(outsider, project.id))),
    'somebody outside the team still sees nothing'
  )
  api.inviteMember(owner, project.id, outsider.id)
  const outsiderInbox = api.myInvitations(outsider)
  check(outsiderInbox.length === 1, 'they are asked, not added')
  check(
    api.getProject(owner, project.id).memberCount === 1,
    'and the count stays people with access',
    String(api.getProject(owner, project.id).memberCount)
  )
  api.respond(outsider, outsiderInbox[0].id, true)
  check(
    api.listProjects(outsider).some((entry) => entry.via === 'invite'),
    'accepting gives them access through the invitation'
  )
  check(
    api.listDocuments(outsider, project.id).length >= 2,
    'and the work is theirs to read'
  )
  check(
    /on your team/i.test(refused(() => api.removeMember(owner, project.id, mate.id))),
    'the team member is still removed only through the team'
  )
  const afterRemoval = api.removeMember(owner, project.id, outsider.id)
  check(afterRemoval.members.length === 1, 'the invited person can be removed by the row')
  check(
    /not found/i.test(refused(() => api.getProject(outsider, project.id))),
    'and loses the project'
  )
  check(api.listDocuments(owner, project.id).length === 2, 'while the work stays put')

  /* ---- 12. leaving the team takes everything with it --------------- */
  api.removeTeamMember(owner, mate.id)
  check(
    /not found/i.test(refused(() => api.getProject(mate, project.id))),
    'removing somebody from the team closes the project to them'
  )
  check(api.listProjects(mate).length === 0, 'and every project of that owner')
  check(
    /not found/i.test(refused(() => api.listDocuments(mate, project.id))),
    'and their documents with it'
  )
  check(
    api.listDocuments(owner, project.id).length === 2 &&
      api.getDocument(owner, project.id, intro.id).blocks.length === 3,
    'while everything they wrote is still there, with their name on it'
  )
  check(api.findUserById(mate.id) !== null, 'and the person is untouched')

  /* ---- 13. joining the team answers an old project question -------- */
  api.inviteMember(owner, project.id, outsider.id)
  check(
    api.getProject(owner, project.id).invitations.length === 1,
    'a project question is waiting for somebody outside the team'
  )
  api.inviteTeamMember(owner, outsider.id)
  const outsiderInboxAgain = api.myInvitations(outsider)
  const teamAsk = outsiderInboxAgain.find((entry) => entry.kind === 'team')
  check(
    Boolean(teamAsk) &&
      outsiderInboxAgain.some((entry) => entry.kind === 'project'),
    'who is then asked to join the team, with the project question still open'
  )
  api.respond(outsider, teamAsk.id, true)
  check(
    api.myInvitations(outsider).length === 0,
    'joining the team answers the project question in advance'
  )
  check(
    api.getProject(owner, project.id).invitations.length === 0,
    'so the owner is no longer waiting on it'
  )
  check(
    api.listProjects(outsider).some((entry) => entry.id === project.id && entry.via === 'team'),
    'and the project is open through the team instead'
  )

  console.log('')
  if (failures === 0) console.log('collaboration: all checks passed')
  if (failures > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
