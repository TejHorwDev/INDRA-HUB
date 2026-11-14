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
    endpoint: text('B2_ENDPOINT'),
    region: text('B2_REGION') || 'us-west-004'
  },

  supabaseBucket: text('SUPABASE_BUCKET') || 'loader-files',

  publicBaseUrl: text('PUBLIC_BASE_URL').replace(/\/+$/, '')
} as const

export function databaseReady(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseServiceKey)
}

export function adminReady(): boolean {
  return Boolean(env.adminUsername && env.adminPassword && env.sessionSecret.length >= 32)
}
