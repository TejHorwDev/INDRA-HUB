# Ledger

The service ledger: who I built for, what they paid, and a receipt they can keep.

Not connected to the loader. Same Supabase *project*, different tables (`svc_*`), no shared
reads in either direction.

## What it does

- **Clients** — a client number in order (`CL-001`), contact details, notes.
- **Work** — what was built for them, when it was delivered, what it cost.
- **Payments** — amount, currency (NPR or USD, per payment), method, reference. A receipt
  number is issued by the database and never reused.
- **Receipts** — a PNG drawn on a canvas, 2× for phone screens, with your business name,
  contact line, the client, the amount and a PAID stamp. Downloads straight from the browser.
- **Client logins** — each client gets a username and password from their page. They sign in
  and see only their own work and their own receipts; the client id comes from the session,
  never from a URL.

## Setup

Two environment variables on the host:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

Then open `/login` — the first screen asks for your business name, a username and a password,
because there is no seeded account to leak.

## Schema

`supabase/clients.sql` — run once in the SQL editor. Tables are RLS-enabled with no policies,
so only the service role (server-side only) can read them.

## Trust boundaries

- The service key is imported exclusively by server components and server actions.
- Every write is a server action that calls `requireOwner()` or `requireUser()` first.
- Session tokens are random; the table stores only their SHA-256.
- Passwords are scrypt with a per-user salt, compared in constant time.
