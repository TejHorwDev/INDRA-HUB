/*
 * The ledger — clients, what was built, what was paid.
 *
 * Everything here is prefixed `svc_` and has nothing to do with the loader's tables in the
 * same project: this app never reads `loader_apps` or `loader_config`, and nothing in the
 * loader reads these. The prefix is the boundary, and the review rule that keeps it true is
 * "no query in this app names a table without it".
 *
 * RLS is on with no policies, exactly as the loader's tables are: the anon key can see
 * nothing at all, and the only thing that can read these rows is the service role, which
 * lives in the server process and nowhere else.
 */

create extension if not exists pgcrypto;

/* Receipt numbers are sequential and never reused — a cancelled payment still burns its
 * number, which is what makes "receipt R-2026-0007" mean one thing and one thing only. */
create sequence if not exists svc_receipt_seq;

create table if not exists svc_clients (
  id          uuid primary key default gen_random_uuid(),
  client_no   text not null unique,
  name        text not null,
  company     text,
  phone       text,
  email       text,
  country     text,
  status      text not null default 'active',
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists svc_projects (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references svc_clients(id) on delete cascade,
  title        text not null,
  kind         text not null default 'app',
  url          text,
  delivered_on date,
  price        numeric(12, 2) not null default 0,
  currency     text not null default 'NPR',
  notes        text,
  created_at   timestamptz not null default now()
);

create table if not exists svc_payments (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references svc_clients(id) on delete cascade,
  project_id  uuid references svc_projects(id) on delete set null,
  amount      numeric(12, 2) not null check (amount > 0),
  currency    text not null default 'NPR',
  method      text,
  paid_on     date not null default current_date,
  reference   text,
  note        text,
  receipt_no  text not null unique default (
    'R-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('svc_receipt_seq')::text, 4, '0')
  ),
  created_at  timestamptz not null default now()
);

/* One login per client, or none. The owner is a row here with client_id null. */
create table if not exists svc_users (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references svc_clients(id) on delete cascade,
  username      text not null unique,
  password_hash text not null,
  role          text not null default 'client',
  status        text not null default 'active',
  created_at    timestamptz not null default now()
);

/* Only the SHA-256 of a session token is stored, so a copy of this table cannot be replayed. */
create table if not exists svc_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references svc_users(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

/* Two lines that print on a receipt: business name and contact. */
create table if not exists svc_settings (
  key   text primary key,
  value text not null
);

create index if not exists svc_projects_client on svc_projects (client_id);
create index if not exists svc_payments_client on svc_payments (client_id, paid_on desc);
create index if not exists svc_users_client on svc_users (client_id);
create index if not exists svc_sessions_user on svc_sessions (user_id);

alter table svc_clients  enable row level security;
alter table svc_projects enable row level security;
alter table svc_payments enable row level security;
alter table svc_users    enable row level security;
alter table svc_sessions enable row level security;
alter table svc_settings enable row level security;
