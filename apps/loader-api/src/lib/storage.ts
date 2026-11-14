import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { GetObjectCommand, PutObjectCommand, S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createClient } from '@supabase/supabase-js'
import { env } from './env'

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

export function driver(): Driver {
  if (env.storageDriver) return env.storageDriver as Driver
  if (env.r2.accountId && env.r2.accessKeyId && env.r2.secretAccessKey && env.r2.bucket) return 'r2'
  if (env.b2.keyId && env.b2.applicationKey && env.b2.bucket && env.b2.endpoint) return 'b2'
  if (env.supabaseUrl && env.supabaseServiceKey) return 'supabase'
  return 'local'
}

export function storageReady(): boolean {
  return driver() === 'local' ? process.env.NODE_ENV !== 'production' : true
}

function s3(): S3Client {
  const active = driver()

  if (active === 'r2') {
    return new S3Client({
      region: 'auto',
      endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.r2.accessKeyId, secretAccessKey: env.r2.secretAccessKey }
    })
  }

  return new S3Client({
    region: env.b2.region,
    endpoint: env.b2.endpoint,
    credentials: { accessKeyId: env.b2.keyId, secretAccessKey: env.b2.applicationKey },
    // B2 is path-style; R2 accepts either.
    forcePathStyle: true
  })
}

function bucket(): string {
  const active = driver()
  if (active === 'r2') return env.r2.bucket
  if (active === 'b2') return env.b2.bucket
  return env.supabaseBucket
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
