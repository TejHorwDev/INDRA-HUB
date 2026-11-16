/*
 * Move the bucket, and everything in it, from Supabase Storage to Backblaze B2.
 *
 * Supabase's free plan is 1 GB of storage and 5 GB of egress a month, and this catalogue
 * is 200 MB of installers plus a 14 MB backdrop film — which means the free plan is a
 * countdown, not a home. Backblaze B2 is 10 GB of storage and 1 GB a *day* of downloads,
 * for free, with no card on file.
 *
 * The bytes are the easy half. The hard half is that every row in the database holds an
 * absolute URL, so moving the files without moving the addresses would leave a site whose
 * pictures 404 and a loader whose installers do not resolve. Both halves happen here, and
 * the second is written as `https://<old host>/…/<key>` → `https://<new host>/<key>` so it
 * is idempotent: run it twice and the second run changes nothing.
 *
 * Usage:
 *
 *   node scripts/migrate-storage.mjs            # dry run: says what would move
 *   node scripts/migrate-storage.mjs --apply    # copies, then rewrites the rows
 *   node scripts/migrate-storage.mjs --apply --force   # re-copies objects that exist
 *
 * Environment (all of it already on the API, except the B2 half):
 *
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET
 *   B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET, B2_REGION
 *   B2_PUBLIC_URL   optional: a Cloudflare domain in front of the bucket
 */

import { Readable } from 'node:stream'
import {
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')
const FOLDERS = ['exes', 'images', 'videos']

const env = (name, fallback = '') => (process.env[name] ?? fallback).trim()

const SUPABASE_URL = env('SUPABASE_URL').replace(/\/+$/, '')
const SUPABASE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const SUPABASE_BUCKET = env('SUPABASE_BUCKET', 'loader-files')

const B2_KEY_ID = env('B2_KEY_ID')
const B2_APPLICATION_KEY = env('B2_APPLICATION_KEY')
const B2_BUCKET = env('B2_BUCKET')
const B2_REGION = env('B2_REGION', 'us-west-004')
const B2_ENDPOINT = env('B2_ENDPOINT', `https://s3.${B2_REGION}.backblazeb2.com`)

/**
 * Where the API answers.
 *
 * An installer is not media. `exes/` stays behind `/api/files/…` on purpose — that is the
 * route that hashes what it hands out and knows who asked — so an exe address is rewritten
 * to this origin, not to the bucket's public host. Same rule the uploader already follows.
 */
const API_BASE = env('API_BASE_URL', 'https://indra-loader-api.onrender.com').replace(/\/+$/, '')

const missing = [
  ['SUPABASE_URL', SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', SUPABASE_KEY],
  ['B2_KEY_ID', B2_KEY_ID],
  ['B2_APPLICATION_KEY', B2_APPLICATION_KEY],
  ['B2_BUCKET', B2_BUCKET]
].filter(([, value]) => !value).map(([name]) => name)

if (missing.length > 0) {
  console.error(`Nothing to do: ${missing.join(', ')} is not set.`)
  process.exit(1)
}

/** The old address, as it appears in a row. */
const sourceBase = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}`

/** The new one. Derived from the region the same way the API derives it. */
const cluster = /(\d{3})\s*$/.exec(B2_REGION)?.[1] ?? '004'
const targetBase = (env('B2_PUBLIC_URL') || `https://f${cluster}.backblazeb2.com/file/${B2_BUCKET}`).replace(/\/+$/, '')

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
const s3 = new S3Client({
  region: B2_REGION,
  endpoint: B2_ENDPOINT,
  credentials: { accessKeyId: B2_KEY_ID, secretAccessKey: B2_APPLICATION_KEY },
  forcePathStyle: true,
  // Backblaze refuses the checksum trailer this SDK sends by default, and the failure
  // reads as NotImplemented rather than as anything to do with checksums.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED'
})

/**
 * Say what broke, in one line, on the run page.
 *
 * This script is run by somebody who has just pasted six secrets into a form, from a phone
 * as often as not, and a Node stack trace is not an answer to "it stopped". The stage is
 * tracked so the line can name the thing that failed, and `::error::` is what turns a
 * console line into an annotation the run page shows without opening a log.
 */
let stage = 'starting'

function report(error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  console.error(`::error::${stage} — ${message}`)
  console.error(error)
  process.exit(1)
}

process.on('unhandledRejection', report)
process.on('uncaughtException', report)

const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/* ------------------------------------------------------------------ inventory */

async function listSource() {
  const objects = []

  for (const folder of FOLDERS) {
    let offset = 0
    for (;;) {
      const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).list(folder, { limit: 100, offset })
      if (error) throw new Error(`listing ${folder}: ${error.message}`)
      if (!data?.length) break

      for (const entry of data) {
        // A folder placeholder has no id, and is not a file.
        if (!entry.id) continue
        objects.push({
          key: `${folder}/${entry.name}`,
          bytes: Number(entry.metadata?.size ?? 0),
          type: entry.metadata?.mimetype || contentTypeOf(entry.name)
        })
      }

      if (data.length < 100) break
      offset += data.length
    }
  }

  return objects
}

function contentTypeOf(name) {
  const ext = name.split('.').pop()?.toLowerCase()
  return (
    {
      exe: 'application/octet-stream',
      mp4: 'video/mp4',
      webm: 'video/webm',
      m4v: 'video/x-m4v',
      ogg: 'video/ogg',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      avif: 'image/avif'
    }[ext] ?? 'application/octet-stream'
  )
}

/* -------------------------------------------------------------------- copying */

async function alreadyThere(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: B2_BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

/**
 * One object, streamed.
 *
 * The installer is 122 MB. Buffering it in the runner would work and would also be the
 * kind of thing that fails on the largest file only — so the body goes from Supabase's
 * response straight into the bucket, with the length declared so the SDK does not have to
 * guess and neither the signature nor the retry has to give up.
 */
async function copy({ key, type }) {
  const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).createSignedUrl(key, 600)
  if (error || !data?.signedUrl) throw new Error(`signing ${key}: ${error?.message ?? 'no url'}`)

  const response = await fetch(data.signedUrl)
  if (!response.ok || !response.body) throw new Error(`reading ${key}: HTTP ${response.status}`)

  const length = Number(response.headers.get('content-length') ?? 0)

  await s3.send(
    new PutObjectCommand({
      Bucket: B2_BUCKET,
      Key: key,
      // Not optional. A bucket that is told a film is `application/octet-stream` does not
      // play it, it downloads it — and a download is not a backdrop.
      ContentType: type,
      ...(length > 0 ? { ContentLength: length } : {}),
      Body: Readable.fromWeb(response.body)
    })
  )
}

/* ---------------------------------------------------------------- the addresses */

async function rewrittenRows() {
  const changes = []

  const { data: apps, error: appsError } = await supabase
    .from('loader_apps')
    .select('id,name,image_url,exe_url')
  if (appsError) throw new Error(`reading loader_apps: ${appsError.message}`)

  for (const app of apps ?? []) {
    const patch = {}
    const image = replaceBase(app.image_url)
    if (image) patch.image_url = image
    const exe = replaceBase(app.exe_url, `${API_BASE}/api/files`)
    if (exe) patch.exe_url = exe
    if (Object.keys(patch).length > 0) changes.push({ table: 'loader_apps', id: app.id, name: app.name, patch })
  }

  const { data: config, error: configError } = await supabase.from('loader_config').select('key,value')
  if (configError) throw new Error(`reading loader_config: ${configError.message}`)

  for (const row of config ?? []) {
    const next = replaceBase(row.value)
    if (next) changes.push({ table: 'loader_config', id: row.key, name: row.key, patch: { value: next } })
  }

  return changes
}

/**
 * An address on the old host, moved to the new one — or null when there is nothing to do.
 *
 * The key is taken from the end of the path, so this also repairs a row that still points
 * at `/api/files/…` from before the artwork was handed to the bucket.
 */
function replaceBase(url, base = targetBase) {
  const raw = (url ?? '').trim()
  if (!raw) return null
  if (raw.startsWith(base)) return null

  const match = /\/((?:exes|images|videos)\/[^/?#]+)$/.exec(raw)
  if (!match) return null

  const next = `${base}/${match[1]}`
  return next === raw ? null : next
}

/* ------------------------------------------------------------------------- run */

stage = 'listing the bucket'
const objects = await listSource()
const total = objects.reduce((sum, object) => sum + object.bytes, 0)

console.log(`${objects.length} objects, ${mb(total)}, in ${SUPABASE_BUCKET}`)
console.log(`  from  ${sourceBase}`)
console.log(`  to    ${targetBase}`)
console.log('')

for (const object of objects) {
  console.log(`  ${object.key.padEnd(60)} ${mb(object.bytes).padStart(9)}  ${object.type}`)
}

stage = 'reading the rows'
const changes = await rewrittenRows()
console.log('')
console.log(`${changes.length} rows point at an address that has to move${changes.length ? ':' : '.'}`)
for (const change of changes) {
  const column = Object.keys(change.patch)[0]
  console.log(`  ${change.table}.${column}  ${change.name}  →  ${change.patch[column]}`)
}

if (!APPLY) {
  console.log('')
  console.log('Dry run. Nothing was copied and nothing was written.')
  console.log('Run again with --apply to move the bytes and the addresses.')
  process.exit(0)
}

console.log('')
let copied = 0
let skipped = 0
const failed = []

for (const object of objects) {
  if (!FORCE && (await alreadyThere(object.key))) {
    skipped += 1
    continue
  }
  try {
    stage = `copying ${object.key}`
    await copy(object)
    copied += 1
    console.log(`  copied ${object.key}`)
  } catch (error) {
    failed.push(`${object.key}: ${error instanceof Error ? error.message : error}`)
    console.log(`  FAILED ${object.key}`)
  }
}

console.log('')
console.log(`copied ${copied}, already present ${skipped}, failed ${failed.length}`)

if (failed.length > 0) {
  for (const line of failed) console.log(`  ${line}`)
  console.log('')
  console.log('Addresses are left alone while a file is missing: a row that points at a 404 is worse than one that still points at the old host.')
  process.exit(1)
}

for (const change of changes) {
  stage = `rewriting ${change.table}.${change.id}`
  const { error } = await supabase.from(change.table).update(change.patch).eq(change.table === 'loader_config' ? 'key' : 'id', change.id)
  if (error) {
    console.log(`  FAILED row ${change.table}.${change.id}: ${error.message}`)
    process.exitCode = 1
  } else {
    console.log(`  updated ${change.table}.${change.id}`)
  }
}

/* Last: prove the objects are actually reachable where the rows now point. */
if (objects.some((object) => object.key.startsWith('images/') || object.key.startsWith('videos/'))) {
  console.log('')
  console.log('Public addresses, checked:')
  for (const object of objects.filter((entry) => !entry.key.startsWith('exes/'))) {
    const url = `${targetBase}/${object.key}`
    stage = `checking ${object.key}`
    const response = await fetch(url, { headers: { range: 'bytes=0-1' } }).catch(() => null)
    const ok = response && (response.ok || response.status === 206)
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${response?.status ?? '—'}  ${url}`)
    if (!ok) {
      console.log('        A bucket that is not public answers 401 here. Make it public in Backblaze, or set B2_PUBLIC_URL.')
    }
  }
}

console.log('')
console.log(`Media now answers from ${targetBase}`);
console.log(`Installers still go through ${API_BASE}/api/files/…, which is where they are hashed and counted.`)
console.log('')
console.log('Done. Set these on the API and redeploy:')
console.log(`  STORAGE_DRIVER=b2`)
console.log(`  B2_KEY_ID / B2_APPLICATION_KEY / B2_BUCKET=${B2_BUCKET} / B2_REGION=${B2_REGION}`)
console.log('Supabase keeps the database. The files are on B2.')
