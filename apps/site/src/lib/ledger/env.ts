/*
 * Configuration, read once on the server.
 *
 * Two values, both from the Supabase project this app shares with the loader — but it
 * shares the *project*, not the tables: everything below lives behind an `svc_` prefix and
 * knows nothing about apps, films or installers.
 *
 * When they are missing the app says so in a sentence instead of throwing a stack trace at
 * whoever opened it. A dashboard that admits it is not connected is worth more than one
 * that looks broken.
 */

function text(name: string): string {
  return (process.env[name] ?? '').trim()
}

export const env = {
  supabaseUrl: text('SUPABASE_URL').replace(/\/+$/, ''),
  serviceKey: text('SUPABASE_SERVICE_ROLE_KEY')
} as const

export const configured = Boolean(env.supabaseUrl && env.serviceKey)

export const MISSING = configured
  ? null
  : 'Not connected. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to this project\'s environment and redeploy.'
