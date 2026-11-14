/*
 * The offline workspace, and the one name it uses.
 *
 * Offline there is no account: the app is a writing tool on this machine. Its
 * work still needs an owner in the database — `documents.created_by` is a
 * foreign key, projects have a head developer — so a single local profile owns
 * it: no password anyone knows, no email that receives anything, never offered
 * as a person anywhere in the app.
 *
 * The name is here, shared, so the main process and the renderer agree on it
 * without either importing the other.
 */

export const OFFLINE_USERNAME = 'offline'
export const OFFLINE_EMAIL = 'offline@this-pc.invalid'
export const OFFLINE_DISPLAY_NAME = 'This PC'
