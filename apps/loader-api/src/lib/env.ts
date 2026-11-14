/*
 * Configuration, read once and validated at boot.
 *
 * Every value here is a secret except the bucket names, so nothing is printed and
 * nothing reaches the client. Missing configuration is reported as a sentence
 * naming the variable — a panel that says "not configured" is far better than one
 * that throws a stack trace at whoever opened it.
 */

function text(name: string): string {
  return (process.env[name] ?? '').trim()
}

export const env = {
  supabaseUrl: text('SUPABASE_URL'),
  supabaseServiceKey: text('SUPABASE_SERVICE_ROLE_KEY'),

  adminUsername: text('ADMIN_USERNAME'),
  adminPassword: text('ADMIN_PASSWORD'),
  sessionSecret: text('ADMIN_SESSION_SECRET'),

  storageDriver: text('STORAGE_DRIVER').toLowerCase(),

  r2: {
    accountId: text('R2_ACCOUNT_ID'),
    accessKeyId: text('R2_ACCESS_KEY_ID'),
    secretAccessKey: text('R2_SECRET_ACCESS_KEY'),
    bucket: text('R2_BUCKET')
  },

  b2: {
    keyId: text('B2_KEY_ID'),
    applicationKey: text('B2_APPLICATION_KEY'),
    bucket: text('B2_BUCKET'),
    /** Optional: derived from the region when it is not set. See `b2Endpoint()`. */
    endpoint: text('B2_ENDPOINT'),
    region: text('B2_REGION') || 'us-west-004'
  },

  supabaseBucket: text('SUPABASE_BUCKET') || 'loader-files',

  publicBaseUrl: text('PUBLIC_BASE_URL').replace(/\/+$/, '')
} as const

/**
 * Backblaze's S3 endpoint, which is entirely a function of the region.
 *
 * Requiring both `B2_ENDPOINT` and `B2_REGION` meant a deployment could look complete
 * and still fall back to local disk because one of two variables that always agree was
 * missing. The region is the fact; the endpoint is arithmetic.
 */
export function b2Endpoint(): string {
  if (env.b2.endpoint) return env.b2.endpoint.replace(/\/+$/, '')
  return `https://s3.${env.b2.region}.backblazeb2.com`
}

/** Everything B2 needs, without demanding the variable that can be derived. */
export function b2Ready(): boolean {
  return Boolean(env.b2.keyId && env.b2.applicationKey && env.b2.bucket)
}

export function databaseReady(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseServiceKey)
}

export function adminReady(): boolean {
  return Boolean(env.adminUsername && env.adminPassword && env.sessionSecret.length >= 32)
}

/** Is there a bucket in front of us at all? Local disk does not count. */
export function storageDriverConfigured(): boolean {
  if (env.storageDriver) return env.storageDriver !== 'local'
  const r2 = Boolean(env.r2.accountId && env.r2.accessKeyId && env.r2.secretAccessKey && env.r2.bucket)
  const b2 = b2Ready()
  const supabase = Boolean(env.supabaseUrl && env.supabaseServiceKey)
  return r2 || b2 || supabase
}
