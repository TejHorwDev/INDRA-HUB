/*
 * The cloud workspace, and what an installation is allowed to know about it.
 *
 * Every installation talks to the same single row (public.indra_workspace) in
 * the project below. The URL and the *publishable* key are compiled in on
 * purpose: a fresh install has to inherit the administrator's settings before
 * anyone has configured anything, and a publishable key is safe to ship because
 * Row Level Security is what decides who may write. The secret key is never in
 * the app and must never be.
 *
 * The row is the source of truth. Each machine keeps a local mirror (SQLite) so
 * the sign-in screen, maintenance screen and registration switch work with no
 * connection at all, and catches up the moment one exists.
 */

export const WORKSPACE_URL = 'https://cztyznuoferktewdhyji.supabase.co'

/** Publishable key. RLS allows SELECT on the workspace row and nothing else. */
export const WORKSPACE_KEY = 'sb_publishable_RVaLkA8l6LOJ4ARqa38tzA_tFuCQqDA'

export const WORKSPACE_ROW_ID = 'primary'
export const WORKSPACE_TABLE = 'indra_workspace'
export const WORKSPACE_BUCKET = 'indra-media'

/** The media types the app can decode, and therefore the only ones it accepts. */
export const WORKSPACE_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/x-m4v', 'video/ogg']

/** 96 MB, matching the local upload cap. */
export const WORKSPACE_MAX_VIDEO_BYTES = 96 * 1024 * 1024

/*
 * One row, as it comes back from PostgREST. Column names are the database's;
 * everything downstream converts to the app's own names once, here.
 */
export interface WorkspaceRow {
  id: string
  revision: number
  allow_registration: boolean
  maintenance: boolean
  maintenance_message: string
  require_activation_key: boolean
  background_asset_id: string | null
  background_mime: string | null
  background_bytes: number
  background_path: string | null
  background_blur: number
  background_dim: number
  updated_at?: string | null
  updated_by?: string | null
}

/** True when an installation is using the endpoint compiled into the build. */
export function isBuiltInWorkspace(url: string | null | undefined, key?: string | null): boolean {
  if (!url) return false
  return normaliseUrl(url) === normaliseUrl(WORKSPACE_URL) && (!key || key === WORKSPACE_KEY)
}

export function normaliseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}
