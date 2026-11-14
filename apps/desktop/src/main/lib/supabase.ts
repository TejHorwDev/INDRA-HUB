import { net } from 'electron'
import { WORKSPACE_KEY, WORKSPACE_URL, normaliseUrl } from '@shared/workspace'
import { readBackendCredentials } from '../services/backend'

/*
 * One HTTP door to the Supabase project.
 *
 * There were two before this file: one inside `cloud.ts` and one inside
 * `workspace.ts`, each with its own timeout, its own error string and its own
 * idea of what a 204 means. A third was about to appear for human sign-in, and
 * three copies of an auth client is three places for a token to be mishandled.
 *
 * Nothing here decides whether a call is allowed — that is the server's job and
 * the caller's, in that order. This module only moves bytes and tells the truth
 * about what came back: the HTTP status and the first part of the body, so a
 * caller can distinguish "wrong password" from "the project is down".
 */

const TIMEOUT_MS = 15_000

export interface SupabaseEndpoint {
  url: string
  key: string
}

/** A failed call, with the status kept so callers can be specific. */
export class SupabaseError extends Error {
  readonly status: number
  readonly detail: string

  constructor(status: number, detail: string) {
    super(readable(detail))
    this.name = 'SupabaseError'
    this.status = status
    this.detail = detail
  }
}

/**
 * The sentence a person can act on, out of an answer meant for a program.
 *
 * PostgREST refuses with `{"code":"P0001","details":null,"hint":null,
 * "message":"A device cannot be an administrator."}`. The panel used to print
 * that whole thing, which tells somebody nothing they can do — so the server's
 * own `message` is what survives, and the JSON is dropped.
 */
function readable(detail: string): string {
  const trimmed = detail.trim()
  if (!trimmed.startsWith('{')) return trimmed
  try {
    const body = JSON.parse(trimmed) as { message?: unknown; hint?: unknown }
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    const hint = typeof body.hint === 'string' ? body.hint.trim() : ''
    if (message && hint) return `${message} ${hint}`
    if (message) return message
  } catch {
    // Not JSON after all: it is already the best text there is.
  }
  return trimmed
}

/**
 * Where the app talks to. An administrator may point the installation at
 * another project (backend settings); otherwise the compiled-in endpoint is
 * used. A secret key pasted into that setting is refused: this app ships a
 * publishable key and must never carry a service key.
 */
export function supabaseEndpoint(): SupabaseEndpoint {
  const configured = readBackendCredentials()
  if (configured) return { url: normaliseUrl(configured.url), key: configured.key }
  return { url: normaliseUrl(WORKSPACE_URL), key: WORKSPACE_KEY }
}

export function supabaseConfigured(): boolean {
  const { url, key } = supabaseEndpoint()
  return Boolean(url) && key.length > 0 && !key.startsWith('sb_secret_')
}

export interface SupabaseRequestOptions {
  method?: string
  body?: unknown
  /** A user's access token. Falls back to the publishable key. */
  token?: string
  prefer?: string
  timeoutMs?: number
}

/**
 * Performs one request and returns the parsed body.
 *
 * `204` and an empty body both answer `undefined`, because that is what they
 * are; a caller that expected rows has to check. Error bodies are truncated —
 * enough to understand the refusal, not enough to fill a log with a token.
 */
export async function supabaseRequest<T>(
  path: string,
  options: SupabaseRequestOptions = {}
): Promise<T> {
  const { url, key } = supabaseEndpoint()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS)
  try {
    const response = await net.fetch(`${url}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        apikey: key,
        Authorization: `Bearer ${options.token ?? key}`,
        'Content-Type': 'application/json',
        ...(options.prefer ? { Prefer: options.prefer } : {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new SupabaseError(response.status, detail.slice(0, 300))
    }
    if (response.status === 204) return undefined as T
    const text = await response.text()
    return (text ? JSON.parse(text) : undefined) as T
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SupabaseError(0, 'the request timed out')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Calls a PostgREST function (`indra_*`) with a user's token. */
export async function supabaseRpc<T>(
  name: string,
  args: Record<string, unknown>,
  token: string
): Promise<T> {
  return supabaseRequest<T>(`/rest/v1/rpc/${name}`, { method: 'POST', body: args, token })
}

/**
 * PostgREST returns a composite-returning function as an object, but a set
 * returning one as an array. Both shapes reach the app; this settles it.
 */
export function asRow<T>(value: T | T[] | null | undefined): T | null {
  if (value === null || value === undefined) return null
  return (Array.isArray(value) ? value[0] : value) ?? null
}
