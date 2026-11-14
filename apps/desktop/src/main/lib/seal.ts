import { safeStorage } from 'electron'

/*
 * Secrets at rest.
 *
 * The OS keystore (DPAPI on Windows, Keychain on macOS, libsecret on Linux) is
 * used when it exists; when it does not, the value is stored with an honest
 * prefix so the app can say so instead of pretending. Nothing here is a
 * password: these are the Supabase public key and the administrator's cloud
 * session, and both are useless without the keystore of the machine they were
 * written on.
 */

const SEALED_PREFIX = 'enc:v1:'
const PLAIN_PREFIX = 'plain:v1:'

export function canSeal(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function sealSecret(secret: string): string {
  if (!canSeal()) return PLAIN_PREFIX + secret
  try {
    return SEALED_PREFIX + safeStorage.encryptString(secret).toString('base64')
  } catch {
    return PLAIN_PREFIX + secret
  }
}

/**
 * Returns the value and whether it came out of a sealed one. An unreadable
 * sealed value is the same as no value: the key or session was written on
 * another machine, or the keychain changed.
 */
export function unsealSecret(stored: string): { value: string; sealed: boolean } {
  if (stored.startsWith(SEALED_PREFIX)) {
    try {
      const value = safeStorage.decryptString(Buffer.from(stored.slice(SEALED_PREFIX.length), 'base64'))
      return { value, sealed: true }
    } catch {
      return { value: '', sealed: false }
    }
  }
  if (stored.startsWith(PLAIN_PREFIX)) {
    return { value: stored.slice(PLAIN_PREFIX.length), sealed: false }
  }
  return { value: stored, sealed: false }
}
