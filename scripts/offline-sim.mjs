/**
 * Offline mode, and the copy that leaves the machine.
 *
 * Two claims are checked here:
 *
 *   1. The app knows when the machine has no route out, and the library (the
 *      only screen that stays online-free) sees every document and deck the
 *      account can reach — and nothing it cannot.
 *   2. A project written to a file comes back whole: same titles, same block
 *      bodies, same slides — and a hand-edited file cannot smuggle markup into
 *      a document on the way back in.
 *
 *   npm run sim:offline
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(tmpdir(), 'indra-offline-sim')
const userData = join(work, 'userdata')
const savedFile = join(work, 'studio.indrahub')

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
  getVersion: () => '1.8.0',
  getPath: () => ${JSON.stringify(userData)},
  relaunch: () => {},
  exit: () => {}
}
const net = { isOnline: () => globalThis.__online !== false }
const dialog = {
  showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
  showOpenDialog: async () => ({ canceled: true, filePaths: [] })
}
const BrowserWindow = { getAllWindows: () => [], fromWebContents: () => null }
module.exports = { app, net, dialog, BrowserWindow, nativeTheme: { shouldUseDarkColors: true, on: () => {} }, safeStorage: { isEncryptionAvailable: () => false }, shell: { openExternal: () => {} } }
`
  )

  writeFileSync(
    join(work, 'entry.ts'),
    `export * from ${JSON.stringify(join(root, 'src/main/services/archive.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/library.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/connectivity.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/auth.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/settings.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/projects.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/documents.ts'))}
export * from ${JSON.stringify(join(root, 'src/main/services/presentations.ts'))}
export * from ${JSON.stringify(join(root, 'src/renderer/src/lib/nav.ts'))}
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

  /* ---- 1. the app knows when there is no route out ----------------- */
  globalThis.__online = true
  check(api.recheckConnectivity().online === true, 'a connected machine reports online')

  globalThis.__online = false
  const offline = api.recheckConnectivity()
  check(offline.online === false, 'an unplugged machine reports offline')
  check(api.isOnline() === false, 'and the rest of the main process agrees')
  check(
    Number.isNaN(Date.parse(offline.since)) === false,
    'the moment it changed is recorded',
    offline.since
  )

  globalThis.__online = true
  check(api.recheckConnectivity().online === true, 'and it recovers on its own', 'still offline')

  /* ---- 1b. the two workspaces the rail offers ---------------------- */
  const online = api.navGroups(false)
  const onlinePaths = online.flatMap((group) => group.items.map((item) => item.to))
  check(!onlinePaths.includes('/documents'), 'online, the rail has no separate Documents entry', onlinePaths.join(','))
  check(!onlinePaths.includes('/presentations'), 'and no separate Presentations entry')
  check(
    onlinePaths.includes('/dashboard') && onlinePaths.includes('/home'),
    'because a project is the container for both'
  )

  const offlineGroups = api.navGroups(true)
  const offlinePaths = offlineGroups.flatMap((group) => group.items.map((item) => item.to))
  check(
    offlinePaths.includes('/documents') && offlinePaths.includes('/presentations'),
    'offline, Documents and Presentations are the workspace',
    offlinePaths.join(',')
  )
  check(offlineGroups.length === 1, 'in one group, with no headings to explain a second')
  check(
    api.navDestinations(false).every((entry) => entry.to !== '/documents'),
    'the command palette follows the same list online'
  )
  check(
    api.isLibraryPath('/documents') && api.isLibraryPath('/presentations/123') && !api.isLibraryPath('/dashboard'),
    'and the library is recognisable as a route, so online it can redirect'
  )

  /* ---- 2. work is written locally, whoever is on the machine ------- */
  const owner = api.register({
    username: 'asha',
    displayName: 'Asha Rai',
    email: 'asha@example.test',
    password: 'CorrectHorse9'
  })
  const other = api.register({
    username: 'bikash',
    displayName: 'Bikash Shah',
    email: 'bikash@example.test',
    password: 'CorrectHorse9'
  })

  const studio = api.createProject(owner, { name: 'The studio', description: 'Autumn work' })
  const doc = api.createDocument(owner, studio.id, 'Launch brief')
  api.saveDocument(owner, studio.id, doc.id, {
    baseVersion: doc.version,
    title: 'Launch brief',
    blocks: [
      { id: 'b1', type: 'heading1', html: 'Launch' },
      { id: 'b2', type: 'paragraph', html: '<b>Ship</b> it <script>alert(1)</script>' }
    ]
  })
  const deck = api.createBlankPresentation(owner, studio.id, 'Launch deck')
  api.savePresentation(owner, studio.id, deck.id, {
    title: 'Launch deck',
    slides: [
      { id: 's1', layout: 'title', title: 'Launch', notes: '' },
      { id: 's2', layout: 'bullets', title: 'Plan', bullets: ['One', 'Two'], notes: 'say it' }
    ]
  })

  const privateProject = api.createProject(other, { name: 'Somebody else' })
  api.createDocument(other, privateProject.id, 'Not yours')

  /* ---- 3. the library sees exactly what it should ------------------ */
  const snapshot = api.librarySnapshot(owner)
  check(snapshot.documents.length === 1, 'the library lists one document', String(snapshot.documents.length))
  check(snapshot.documents[0].title === 'Launch brief', 'with its title')
  check(snapshot.documents[0].projectName === 'The studio', 'and the project it lives in')
  check(snapshot.presentations.length === 1, 'and one deck')
  check(snapshot.presentations[0].slideCount === 2, 'with its slide count', String(snapshot.presentations[0].slideCount))
  check(
    snapshot.documents.every((item) => item.title !== 'Not yours'),
    'a project this account cannot open contributes nothing'
  )

  /* ---- 4. a copy on this PC, and back again ------------------------ */
  const archive = api.archiveProject(owner, studio.id)
  check(archive.format === 'indrahub.project' && archive.version === 1, 'the file names its format')
  check(archive.documents.length === 1 && archive.presentations.length === 1, 'and carries the work')
  api.writeArchive(archive, savedFile)
  const written = readFileSync(savedFile, 'utf8')
  check(written.includes('Launch brief') && written.includes('Launch deck'), 'the file is on disk and readable')

  const restored = api.restoreArchive(owner, written)
  check(restored.id !== studio.id, 'an opened copy is a new project, not the same row')
  check(restored.name === 'The studio', 'with the same name', restored.name)

  const restoredDocs = api.listDocuments(owner, restored.id)
  check(restoredDocs.length === 1 && restoredDocs[0].title === 'Launch brief', 'and the same document')

  const restoredDoc = api.getDocument(owner, restored.id, restoredDocs[0].id)
  check(restoredDoc.blocks.length === 2, 'with both blocks', String(restoredDoc.blocks.length))
  const body = restoredDoc.blocks[1]?.html ?? ''
  check(body.includes('<b>Ship</b>'), 'and its markup intact', body)
  check(!body.includes('<script'), 'and the script that was never allowed is gone', body)

  const restoredDecks = api.listPresentations(owner, restored.id)
  check(restoredDecks.length === 1 && restoredDecks[0].title === 'Launch deck', 'and the deck')
  const restoredDeck = api.getPresentation(owner, restored.id, restoredDecks[0].id)
  check(restoredDeck.slides.length === 2, 'with both slides', String(restoredDeck.slides.length))
  check(
    restoredDeck.slides[1]?.bullets?.join(',') === 'One,Two',
    'and their content',
    JSON.stringify(restoredDeck.slides[1]?.bullets)
  )

  /* ---- 5. a file is not trusted just because it is a file ---------- */
  check(
    /not a saved INDRA HUB project/i.test(refused(() => api.restoreArchive(owner, 'not json'))),
    'a file that is not ours is refused'
  )
  check(
    /not a saved INDRA HUB project/i.test(refused(() => api.restoreArchive(owner, '{"format":"x","version":1}'))),
    'and one that claims another format'
  )
  check(
    /newer version/i.test(
      refused(() =>
        api.restoreArchive(
          owner,
          JSON.stringify({ format: 'indrahub.project', version: 2, project: { name: 'x' }, documents: [], presentations: [] })
        )
      )
    ),
    'a file from a future build says so'
  )
  check(
    api.listProjects(owner).length === 2,
    'no half-built project is left behind by a rejected file',
    String(api.listProjects(owner).length)
  )

  /* ---- 5b. a file that breaks halfway leaves nothing behind -------- */
  const before = api.listProjects(owner).length
  const broken = JSON.stringify({
    format: 'indrahub.project',
    version: 1,
    exportedAt: new Date().toISOString(),
    project: { name: 'Half a project', description: '' },
    documents: [{ title: 'Fine', blocks: [{ id: 'x', type: 'paragraph', html: 'ok' }], createdAt: '', updatedAt: '' }],
    presentations: [{ title: 'Broken', theme: 'minimal', slides: 'not a list', createdAt: '', updatedAt: '' }]
  })
  const broke = refused(() => api.restoreArchive(owner, broken))
  check(broke.length > 0, 'a file that breaks halfway is refused', broke)
  check(
    api.listProjects(owner).length === before,
    'and the project it had already started is removed',
    `${before} → ${api.listProjects(owner).length}`
  )

  /* ---- 6. opening your own file twice gives you two projects ------- */
  const again = api.restoreArchive(owner, written)
  check(again.id !== restored.id, 'the same file opened twice makes a second project')
  check(api.listProjects(owner).length === 3, 'and both are listed', String(api.listProjects(owner).length))

  console.log('')
  if (failures === 0) console.log('offline: all checks passed')
  if (failures > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
