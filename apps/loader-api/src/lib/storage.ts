import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createClient } from '@supabase/supabase-js'
import { env } from './env'
import { storageSettings } from './storage-config'

/*
 * Where the files live.
 *
 * The order is deliberate: R2, then B2, then Supabase Storage, then local disk.
 * The first one with credentials wins, so a deployment needs no decision beyond
 * filling in what it has.
 *
 * Uploads are presigned. A 300 MB installer goes from the browser directly to the
 * bucket and never passes through this server, which is the difference between a
 * function that can host a catalogue and one that runs out of memory on the first
 * product.
 */

export type Driver = 'r2' | 'b2' | 'supabase' | 'local'
export type Kind = 'exe' | 'image' | 'video'

const LOCAL_ROOT = join(process.cwd(), '.data', 'uploads')

/*
 * Which bucket, decided in one place.
 *
 * `storageSettings()` merges what the panel saved with what the environment carries,
 * so every caller here — the proxy, the upload signer, the hashing, the health check —
 * agrees on one answer without any of them knowing about environment variables.
 */
export function driver(): Driver {
  return storageSettings().driver
}

export function storageReady(): boolean {
  return driver() === 'local' ? process.env.NODE_ENV !== 'production' : true
}

function s3(): S3Client {
  const settings = storageSettings()

  if (settings.driver === 'r2') {
    return new S3Client({
      region: 'auto',
      endpoint: `https://${settings.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: settings.r2.accessKeyId,
        secretAccessKey: settings.r2.secretAccessKey
      }
    })
  }

  return new S3Client({
    region: settings.b2.region,
    endpoint: settings.b2.endpoint,
    credentials: {
      accessKeyId: settings.b2.keyId,
      secretAccessKey: settings.b2.applicationKey
    },
    // B2 is path-style; R2 accepts either.
    forcePathStyle: true
  })
}

function bucket(): string {
  const settings = storageSettings()
  if (settings.driver === 'r2') return settings.r2.bucket
  if (settings.driver === 'b2') return settings.b2.bucket
  return settings.supabaseBucket
}

/**
 * A key we issued, and nothing else.
 *
 * Every route that turns a key back into a file runs this first: no traversal, no
 * absolute paths, no keys from anywhere but `objectKey`.
 */
export function isObjectKey(key: string): boolean {
  return /^(exes|images|videos)\/[a-zA-Z0-9._-]+$/.test(key)
}

/** The folder each kind lives in. One place, so a key and its kind cannot disagree. */
const FOLDER: Record<Kind, string> = { exe: 'exes', image: 'images', video: 'videos' }

/** A key that cannot collide, and names the kind of thing it is. */
export function objectKey(kind: Kind, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-60)
  const stamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8)
  return `${FOLDER[kind]}/${stamp}-${random}-${safe}`
}

/* ------------------------------------------------------------- size limits */

/**
 * How large a file may be, per kind and per driver.
 *
 * The rule is not ours to choose: it is whatever the bucket in front of us will
 * accept. Supabase Storage takes **50 MB per file** by default on a free project (the
 * ceiling can be raised in the dashboard, but the free plan's 1 GB of storage and 5 GB
 * of monthly egress are the real limits) — and a Windows installer for this app is
 * around 120 MB. That combination is a wall, and the panel has to say so *before* a
 * browser spends ten minutes uploading into it.
 *
 * R2 and B2 have no such per-file ceiling, and their egress is free or nearly free, so
 * the same installer is fine there. Local disk is development only.
 */
const MB = 1024 * 1024

export function capFor(kind: Kind): number {
  const active = driver()
  if (active === 'local') return 2048 * MB
  if (active === 'supabase') return kind === 'image' ? 10 * MB : 48 * MB
  return kind === 'image' ? 20 * MB : kind === 'video' ? 400 * MB : 2048 * MB
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const mb = bytes / MB
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

/**
 * Why this file cannot be uploaded here, or null when it can.
 *
 * A sentence, not a status code: the person reading it needs to know which wall they
 * hit and what to do instead.
 */
export function refusalFor(kind: Kind, bytes: number): string | null {
  const cap = capFor(kind)
  if (bytes <= cap) return null

  const what = kind === 'exe' ? 'installer' : kind === 'video' ? 'video' : 'image'
  const active = driver()

  if (active === 'supabase') {
    return kind === 'exe'
      ? `That ${what} is ${formatBytes(bytes)}; this bucket takes ${formatBytes(cap)} per file (Supabase Storage). A build that size belongs in a GitHub release — or set R2_BUCKET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY and this bucket takes 2 GB.`
      : `That ${what} is ${formatBytes(bytes)}; this bucket takes ${formatBytes(cap)} per file. Compress it, or move storage to R2.`
  }
  return `That ${what} is ${formatBytes(bytes)}; this bucket takes ${formatBytes(cap)} per file.`
}

/**
 * Everything in one folder of the bucket, right now.
 *
 * Read from the bucket every time, never cached. That is the point: a file deleted in
 * the Supabase console is gone the next time this is asked, so the panel cannot go on
 * claiming an installer exists that no longer does.
 */
export interface StoredObject {
  key: string
  bytes: number
}

export async function listObjects(kind: Kind): Promise<StoredObject[]> {
  const active = driver()

  if (active === 'local') {
    const { readdir } = await import('node:fs/promises')
    const dir = join(LOCAL_ROOT, FOLDER[kind])
    const names = await readdir(dir).catch(() => [] as string[])
    const objects: StoredObject[] = []
    for (const name of names) {
      const info = await stat(join(dir, name)).catch(() => null)
      if (info) objects.push({ key: `${FOLDER[kind]}/${name}`, bytes: info.size })
    }
    return objects
  }

  if (active === 'supabase') {
    const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false }
    })
    const objects: StoredObject[] = []
    let offset = 0
    for (;;) {
      const { data, error } = await supabase.storage
        .from(env.supabaseBucket)
        .list(FOLDER[kind], { limit: 100, offset })
      if (error || !data?.length) break
      for (const entry of data) {
        // A folder placeholder is not a file.
        if ((entry as { id?: string | null }).id === null) continue
        const size = Number((entry.metadata as { size?: unknown } | null)?.size ?? 0)
        objects.push({
          key: `${FOLDER[kind]}/${entry.name}`,
          bytes: Number.isFinite(size) ? size : 0
        })
      }
      if (data.length < 100) break
      offset += data.length
    }
    return objects
  }

  const objects: StoredObject[] = []
  let token: string | undefined
  do {
    const page = await s3().send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: `${FOLDER[kind]}/`,
        ContinuationToken: token
      })
    )
    for (const object of page.Contents ?? []) {
      if (object.Key) objects.push({ key: object.Key, bytes: object.Size ?? 0 })
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return objects
}

/** The keys present in one folder, without the sizes. */
export async function keySet(kind: Kind): Promise<Set<string>> {
  return new Set((await listObjects(kind)).map((object) => object.key))
}

/**
 * What is stored, per kind.
 *
 * Counted rather than guessed. It exists because "where do the exes go?" deserves an
 * answer with a number in it, and because a bucket filling up is the kind of thing
 * that should be visible in the panel before it is visible as a failed upload.
 */
export interface Usage {
  count: number
  bytes: number
}

export async function usageByKind(): Promise<Record<Kind, Usage> | { error: string }> {
  const empty = (): Record<Kind, Usage> => ({ exe: { count: 0, bytes: 0 }, image: { count: 0, bytes: 0 }, video: { count: 0, bytes: 0 } })
  const result = empty()
  const active = driver()

  try {
    if (active === 'local') {
      const { readdir } = await import('node:fs/promises')
      for (const kind of Object.keys(FOLDER) as Kind[]) {
        const dir = join(LOCAL_ROOT, FOLDER[kind])
        const names = await readdir(dir).catch(() => [] as string[])
        for (const name of names) {
          const info = await stat(join(dir, name)).catch(() => null)
          if (!info) continue
          result[kind].count += 1
          result[kind].bytes += info.size
        }
      }
      return result
    }

    if (active === 'supabase') {
      const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey, {
        auth: { persistSession: false }
      })
      for (const kind of Object.keys(FOLDER) as Kind[]) {
        let offset = 0
        for (;;) {
          const { data, error } = await supabase.storage
            .from(env.supabaseBucket)
            .list(FOLDER[kind], { limit: 100, offset })
          if (error || !data?.length) break
          for (const entry of data) {
            const size = Number((entry.metadata as { size?: unknown } | null)?.size ?? 0)
            result[kind].count += 1
            result[kind].bytes += Number.isFinite(size) ? size : 0
          }
          if (data.length < 100) break
          offset += data.length
        }
      }
      return result
    }

    for (const kind of Object.keys(FOLDER) as Kind[]) {
      let token: string | undefined
      do {
        const page = await s3().send(
          new ListObjectsV2Command({
            Bucket: bucket(),
            Prefix: `${FOLDER[kind]}/`,
            ContinuationToken: token
          })
        )
        for (const object of page.Contents ?? []) {
          result[kind].count += 1
          result[kind].bytes += object.Size ?? 0
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined
      } while (token)
    }
    return result
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'the bucket could not be listed' }
  }
}

export interface UploadTarget {
  /** Where the browser PUTs the bytes. */
  uploadUrl: string
  method: 'PUT' | 'POST'
  /** Any header the browser must echo for the signature to hold. */
  headers: Record<string, string>
  key: string
  /** What to store in the row once the upload finishes. */
  publicUrl: string
}

function publicUrlFor(key: string): string {
  if (env.publicBaseUrl) return `${env.publicBaseUrl}/${key}`
  // No public base: the bucket is private and the API streams the object. Slower,
  // correct, and it means a bucket never has to be made world-readable to work.
  return `/api/files/${key}`
}

export async function createUploadTarget(
  kind: Kind,
  filename: string,
  contentType: string
): Promise<UploadTarget> {
  const key = objectKey(kind, filename)
  const active = driver()

  if (active === 'local') {
    return {
      uploadUrl: `/api/admin/local-upload?key=${encodeURIComponent(key)}`,
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      key,
      publicUrl: publicUrlFor(key)
    }
  }

  if (active === 'supabase') {
    const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false }
    })
    const { data, error } = await supabase.storage.from(env.supabaseBucket).createSignedUploadUrl(key)
    if (error || !data) throw new Error(error?.message ?? 'could not sign an upload')

    /*
     * Not a signed URL. A signed URL expires, and what is stored in the row has to
     * work in a year; the API serves the object instead, and keeps working because
     * it signs every read.
     */
    return {
      uploadUrl: data.signedUrl,
      method: 'PUT',
      headers: { 'content-type': contentType },
      key,
      publicUrl: publicUrlFor(key)
    }
  }

  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: contentType
  })
  const uploadUrl = await getSignedUrl(s3(), command, { expiresIn: 900 })

  return {
    uploadUrl,
    method: 'PUT',
    headers: { 'content-type': contentType },
    key,
    publicUrl: publicUrlFor(key)
  }
}

/** The object, as a stream, for the proxy and for hashing after an upload. */
export async function openObject(key: string): Promise<Readable | null> {
  const active = driver()

  if (active === 'local') {
    const path = join(LOCAL_ROOT, key)
    try {
      await stat(path)
      return createReadStream(path)
    } catch {
      return null
    }
  }

  if (active === 'supabase') {
    const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false }
    })
    const { data } = await supabase.storage.from(env.supabaseBucket).createSignedUrl(key, 300)
    if (!data?.signedUrl) return null
    const response = await fetch(data.signedUrl)
    if (!response.ok || !response.body) return null
    return Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  }

  try {
    const result = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }))
    return (result.Body as Readable | undefined) ?? null
  } catch {
    return null
  }
}

/**
 * The object as a stream, with its size, and with ranges honoured.
 *
 * This is the difference between a download that can be measured and resumed and one
 * that arrives as an unmeasured trickle. Without a length a client cannot show progress
 * — it can only count bytes and guess — and without ranges a retry starts from zero and
 * a looping video has to re-fetch the file to play it again.
 *
 * `end` is inclusive, as HTTP means it.
 */
export interface ObjectRead {
  stream: Readable
  /** Full size of the object, or 0 when the backend cannot report one. */
  size: number
  /** Bytes in this response. */
  length: number
  /** The range that was actually served, when one was asked for and honoured. */
  range: { start: number; end: number } | null
}

export async function readObject(
  key: string,
  range?: { start: number; end?: number }
): Promise<ObjectRead | null> {
  const active = driver()

  if (active === 'local') {
    const path = join(LOCAL_ROOT, key)
    let size = 0
    try {
      size = (await stat(path)).size
    } catch {
      return null
    }
    if (!range) {
      return { stream: createReadStream(path), size, length: size, range: null }
    }
    const end = Math.min(range.end ?? size - 1, size - 1)
    if (range.start > end) return null
    return {
      stream: createReadStream(path, { start: range.start, end }),
      size,
      length: end - range.start + 1,
      range: { start: range.start, end }
    }
  }

  if (active === 'supabase') {
    const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false }
    })
    const { data } = await supabase.storage.from(env.supabaseBucket).createSignedUrl(key, 300)
    if (!data?.signedUrl) return null

    // The signed URL answers Range with 206 and a content-range, which carries the total
    // even when no range was asked for. One request, so a HEAD is not needed.
    const response = await fetch(data.signedUrl, {
      headers: range ? { range: `bytes=${range.start}-${range.end ?? ''}` } : {}
    })
    if (!response.ok || !response.body) return null

    const stream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
    const contentRange = response.headers.get('content-range')
    const parsed = contentRange ? /bytes\s+(\d+)-(\d+)\/(\d+)/.exec(contentRange) : null
    if (parsed) {
      const start = Number(parsed[1])
      const end = Number(parsed[2])
      const size = Number(parsed[3])
      return {
        stream,
        size,
        length: end - start + 1,
        range: { start, end }
      }
    }

    const length = Number(response.headers.get('content-length')) || 0
    return { stream, size: length, length, range: null }
  }

  try {
    const result = await s3().send(
      new GetObjectCommand({
        Bucket: bucket(),
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end ?? ''}` } : {})
      })
    )
    const stream = (result.Body as Readable | undefined) ?? null
    if (!stream) return null
    const contentRange = result.ContentRange ? /bytes\s+(\d+)-(\d+)\/(\d+)/.exec(result.ContentRange) : null
    if (contentRange) {
      return {
        stream,
        size: Number(contentRange[3]),
        length: result.ContentLength ?? 0,
        range: { start: Number(contentRange[1]), end: Number(contentRange[2]) }
      }
    }
    const size = result.ContentLength ?? 0
    return { stream, size, length: size, range: null }
  } catch {
    return null
  }
}

/**
 * An address the client can fetch the object from itself.
 *
 * The API is a proxy: bytes come out of a bucket into this process and then out to the
 * browser, which is right for an installer (private, hashed, one hop is enough) and wrong
 * for a video, which is streamed twice and buffered twice by a free-tier server that is
 * not a CDN. A signed address is handed out instead, so the film comes from the bucket
 * edge on the first play — after which the loader keeps its own copy and asks for
 * nothing at all.
 *
 * Short-lived on purpose: the value is used immediately, by the request that asked for it.
 * Local disk has no second address, so a deployment on it simply streams as before.
 */
export async function directUrl(key: string, expiresIn = 300): Promise<string | null> {
  const active = driver()
  if (active === 'local') return null

  try {
    if (active === 'supabase') {
      const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey, {
        auth: { persistSession: false }
      })
      const { data } = await supabase.storage.from(env.supabaseBucket).createSignedUrl(key, expiresIn)
      return data?.signedUrl ?? null
    }

    return await getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn })
  } catch {
    return null
  }
}

/** Local only: the bytes of a direct upload. */
export async function localWrite(key: string, body: Readable): Promise<void> {
  const path = join(LOCAL_ROOT, key)
  await mkdir(dirname(path), { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(path)
    body.pipe(out)
    body.on('error', reject)
    out.on('error', reject)
    out.on('finish', () => resolve())
  })
}

export async function removeObject(key: string): Promise<void> {
  const active = driver()
  try {
    if (active === 'local') {
      await rm(join(LOCAL_ROOT, key), { force: true })
      return
    }
    if (active === 'supabase') {
      await createClient(env.supabaseUrl, env.supabaseServiceKey, {
        auth: { persistSession: false }
      })
        .storage.from(env.supabaseBucket)
        .remove([key])
      return
    }
    await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }))
  } catch (error) {
    // A file that cannot be removed is a tidy-up problem, not a request failure.
    console.warn('[storage] could not remove', key, error)
  }
}

/* ---------------------------------------------------------------- the probe */

/**
 * Writes one small object, reads it back, and deletes it.
 *
 * The only way to know a bucket works. A form that saves credentials is a form that
 * saves credentials; whether the key can actually write is a different question, and it
 * is the one that matters at 2 a.m. when an upload has failed.
 */
export async function probeStorage(): Promise<{ ok: boolean; driver: Driver; message: string }> {
  const active = driver()
  const key = `probes/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.txt`
  const body = 'indra loader storage probe'

  try {
    if (active === 'local') {
      await localWrite(key, Readable.from([body]))
      const stream = await openObject(key)
      if (!stream) throw new Error('the file was written but could not be read back')
      await removeObject(key)
      return { ok: true, driver: active, message: 'Local disk accepts writes and reads.' }
    }

    if (active === 'supabase') {
      const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey, {
        auth: { persistSession: false }
      })
      const bucketName = bucket()
      const { error } = await supabase.storage
        .from(bucketName)
        .upload(key, new Blob([body]), { contentType: 'text/plain', upsert: true })
      if (error) throw new Error(error.message)
      await supabase.storage.from(bucketName).remove([key])
      return {
        ok: true,
        driver: active,
        message: `Bucket "${bucketName}" accepts writes. Note the per-file ceiling: ${formatBytes(capFor('exe'))} for installers.`
      }
    }

    const client = s3()
    const Bucket = bucket()
    await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: 'text/plain' }))
    const back = await client.send(new GetObjectCommand({ Bucket, Key: key }))
    const read = back.Body ? await back.Body.transformToString().catch(() => null) : null
    await client.send(new DeleteObjectCommand({ Bucket, Key: key }))
    if (read !== body) throw new Error('the object was written but read back different bytes')
    return {
      ok: true,
      driver: active,
      message: `Bucket "${Bucket}" accepts writes, reads and deletes. Ceiling for installers: ${formatBytes(capFor('exe'))}.`
    }
  } catch (error) {
    return {
      ok: false,
      driver: active,
      message: error instanceof Error ? error.message : 'the bucket refused the probe'
    }
  }
}
