'use server'

/*
 * Every write in the product passes through here.
 *
 * Server actions, not an API: a form posts to the function that owns the decision, the
 * browser never learns a table name or a row shape, and there is no endpoint to forget to
 * guard. Each action asks the same two questions in the same order — who is this, and are
 * they allowed — before it touches a row.
 */

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { db, eq } from '@/lib/db'
import { hashPassword, requireOwner, requireUser, verifyPassword } from '@/lib/auth'
import { nextClientNo } from '@/lib/format'

function field(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Runs a write and turns a failure into a sentence on the page.
 *
 * Without this a broken database looks like a button that does nothing: the action throws,
 * the browser stays where it is, and nobody learns why. The message keeps the database's own
 * words — "row-level security", "duplicate key" — because those name the fix.
 *
 * Redirects are Next's control flow, not failures, so they pass through untouched.
 */
async function guarded(path: string, work: () => Promise<void>): Promise<void> {
  try {
    await work()
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) throw error
    const message = error instanceof Error ? error.message : String(error)
    fail(path, message.slice(0, 240) || 'Nothing happened — the write failed without a reason.')
  }
}

function fail(path: string, message: string): never {
  redirect(`${path}?e=${encodeURIComponent(message)}`)
}

/* ----------------------------------------------------------------- clients -- */

async function createClientInner(form: FormData): Promise<void> {
  await requireOwner()

  const name = field(form, 'name')
  if (!name) fail('/', 'A client needs a name.')

  const existing = await db.select<{ client_no: string }>('svc_clients', 'select=client_no')
  const client_no = field(form, 'client_no') || nextClientNo(existing)

  try {
    await db.insert('svc_clients', {
      client_no,
      name,
      company: field(form, 'company') || null,
      phone: field(form, 'phone') || null,
      email: field(form, 'email') || null,
      country: field(form, 'country') || null,
      notes: field(form, 'notes') || null
    })
  } catch {
    fail('/', `Client number ${client_no} is already used.`)
  }

  revalidatePath('/')
  redirect('/')
}

async function createProjectInner(form: FormData): Promise<void> {
  await requireOwner()
  const clientId = field(form, 'client_id')
  const title = field(form, 'title')
  if (!clientId || !title) fail(`/c/${clientId}`, 'Give the work a title.')

  await db.insert('svc_projects', {
    client_id: clientId,
    title,
    kind: field(form, 'kind') || 'app',
    url: field(form, 'url') || null,
    delivered_on: field(form, 'delivered_on') || null,
    price: Number(field(form, 'price') || 0),
    currency: field(form, 'currency') || 'NPR',
    notes: field(form, 'notes') || null
  })

  revalidatePath(`/c/${clientId}`)
  redirect(`/c/${clientId}`)
}

async function createPaymentInner(form: FormData): Promise<void> {
  await requireOwner()
  const clientId = field(form, 'client_id')
  const amount = Number(field(form, 'amount'))

  if (!clientId) fail('/', 'A payment needs a client.')
  if (!Number.isFinite(amount) || amount <= 0) fail(`/c/${clientId}`, 'The amount must be more than zero.')

  await db.insert('svc_payments', {
    client_id: clientId,
    project_id: field(form, 'project_id') || null,
    amount,
    currency: field(form, 'currency') || 'NPR',
    method: field(form, 'method') || null,
    paid_on: field(form, 'paid_on') || new Date().toISOString().slice(0, 10),
    reference: field(form, 'reference') || null,
    note: field(form, 'note') || null
  })

  revalidatePath(`/c/${clientId}`)
  revalidatePath('/')
  redirect(`/c/${clientId}`)
}

/** Gives a client a way in. Re-running it resets their password. */
async function setPortalAccessInner(form: FormData): Promise<void> {
  await requireOwner()
  const clientId = field(form, 'client_id')
  const username = field(form, 'username').toLowerCase()
  const password = field(form, 'password')

  if (password.length < 8) fail(`/c/${clientId}`, 'The portal password needs at least 8 characters.')

  const existing = await db.select<{ id: string }>('svc_users', `select=id&client_id=eq.${eq(clientId)}`)

  if (existing[0]) {
    await db.update('svc_users', `id=eq.${existing[0].id}`, {
      username: username || undefined,
      password_hash: hashPassword(password),
      status: 'active'
    })
  } else {
    if (username.length < 3) fail(`/c/${clientId}`, 'Pick a username of at least 3 characters.')
    await db.insert('svc_users', {
      client_id: clientId,
      username,
      password_hash: hashPassword(password),
      role: 'client'
    })
  }

  revalidatePath(`/c/${clientId}`)
  redirect(`/c/${clientId}`)
}

async function saveBusinessInner(form: FormData): Promise<void> {
  await requireOwner()
  const entries: [string, string][] = [
    ['business_name', field(form, 'name')],
    ['business_contact', field(form, 'contact')]
  ]

  for (const [key, value] of entries) {
    await db.remove('svc_settings', `key=eq.${key}`)
    if (value) await db.insert('svc_settings', { key, value })
  }

  revalidatePath('/settings')
  redirect('/settings')
}

async function changePasswordInner(form: FormData): Promise<void> {
  const user = await requireUser()
  const current = field(form, 'current')
  const next = field(form, 'next')

  const rows = await db.select<{ password_hash: string }>('svc_users', `select=password_hash&id=eq.${user.id}`)
  if (!rows[0] || !verifyPassword(current, rows[0].password_hash)) {
    fail('/settings', 'The current password is not right.')
  }
  if (next.length < 8) fail('/settings', 'The new password needs at least 8 characters.')

  await db.update('svc_users', `id=eq.${user.id}`, { password_hash: hashPassword(next) })
  redirect('/settings')
}

/* ------------------------------------------------------------------ guards -- */

/*
 * The exported surface. Each action is the same two lines: run the work, and if it failed for
 * a reason that is not a redirect, put that reason on the page.
 */

export async function createClient(form: FormData): Promise<void> {
  await guarded('/', () => createClientInner(form))
}

function clientPath(form: FormData): string {
  const id = form.get('client_id')
  return typeof id === 'string' && id ? `/c/${id}` : '/'
}

export async function createProject(form: FormData): Promise<void> {
  await guarded(clientPath(form), () => createProjectInner(form))
}

export async function createPayment(form: FormData): Promise<void> {
  await guarded(clientPath(form), () => createPaymentInner(form))
}

export async function setPortalAccess(form: FormData): Promise<void> {
  await guarded(clientPath(form), () => setPortalAccessInner(form))
}

export async function saveBusiness(form: FormData): Promise<void> {
  await guarded('/settings', () => saveBusinessInner(form))
}

export async function changePassword(form: FormData): Promise<void> {
  await guarded('/settings', () => changePasswordInner(form))
}
