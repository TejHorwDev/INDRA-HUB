-- ---------------------------------------------------------------------------
-- INDRA HUB — Supabase schema
--
-- Run this once, in the Supabase dashboard: SQL Editor → New query → paste →
-- Run. It is written to be re-runnable: every statement is guarded.
--
-- Everything is prefixed `indra_` so it can live beside other apps in the same
-- project without colliding with `auth.*` or your own tables.
--
-- SECURITY NOTE
-- Row Level Security is enabled and NO policies are created in this file. That
-- means the anon key can read nothing and write nothing: the tables are sealed
-- until authentication is designed in Stage 2. This is deliberate — a desktop
-- app that ships a key must never be able to write to a table it does not own.
-- ---------------------------------------------------------------------------

-- Accounts. Mirrors the local `users` table; `auth_user_id` links a row to a
-- Supabase Auth user once Stage 2 lands.
create table if not exists public.indra_users (
  id              text primary key,
  auth_user_id    uuid references auth.users (id) on delete set null,
  username        text not null,
  display_name    text not null,
  email           text not null,
  created_at      timestamptz not null default now(),
  last_sign_in_at timestamptz,
  suspended_at    timestamptz
);

create unique index if not exists indra_users_username_key on public.indra_users (lower(username));
create unique index if not exists indra_users_email_key    on public.indra_users (lower(email));
create unique index if not exists indra_users_auth_key     on public.indra_users (auth_user_id)
  where auth_user_id is not null;

-- Projects and membership.
create table if not exists public.indra_projects (
  id          text primary key,
  name        text not null,
  description text not null default '',
  owner_id    text not null references public.indra_users (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists indra_projects_owner_idx on public.indra_projects (owner_id);

create table if not exists public.indra_project_members (
  project_id text not null references public.indra_projects (id) on delete cascade,
  user_id    text not null references public.indra_users (id) on delete cascade,
  role       text not null default 'member' check (role in ('member')),
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists indra_members_user_idx on public.indra_project_members (user_id);

-- Documents. `content` holds the same { blocks: [...] } JSON the app produces.
create table if not exists public.indra_documents (
  id         text primary key,
  project_id text not null references public.indra_projects (id) on delete cascade,
  title      text not null,
  content    jsonb not null default '{"blocks":[]}'::jsonb,
  version    integer not null default 1,
  created_by text references public.indra_users (id) on delete set null,
  updated_by text references public.indra_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists indra_documents_project_idx on public.indra_documents (project_id, updated_at desc);

create table if not exists public.indra_document_versions (
  id          text primary key,
  document_id text not null references public.indra_documents (id) on delete cascade,
  version     integer not null,
  title       text not null,
  content     jsonb not null,
  editor_id   text references public.indra_users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (document_id, version)
);

-- Presentations and slides.
create table if not exists public.indra_presentations (
  id                      text primary key,
  project_id              text not null references public.indra_projects (id) on delete cascade,
  title                   text not null,
  theme                   text not null default 'minimal',
  conversion_mode         text not null check (conversion_mode in ('blank', 'rule', 'ai')),
  source_document_id      text references public.indra_documents (id) on delete set null,
  source_document_version integer,
  created_by              text references public.indra_users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists indra_presentations_project_idx on public.indra_presentations (project_id, updated_at desc);

create table if not exists public.indra_presentation_slides (
  id              text primary key,
  presentation_id text not null references public.indra_presentations (id) on delete cascade,
  position        integer not null,
  layout          text not null,
  content         jsonb not null,
  notes           text not null default ''
);

create index if not exists indra_slides_presentation_idx on public.indra_presentation_slides (presentation_id, position);

-- ---------------------------------------------------------------------------
-- Row Level Security: sealed by default.
-- ---------------------------------------------------------------------------
alter table public.indra_users               enable row level security;
alter table public.indra_projects            enable row level security;
alter table public.indra_project_members     enable row level security;
alter table public.indra_documents           enable row level security;
alter table public.indra_document_versions   enable row level security;
alter table public.indra_presentations       enable row level security;
alter table public.indra_presentation_slides enable row level security;

-- `service_role` bypasses RLS by design and is the only way in until Stage 2
-- defines per-user policies. Never ship that key inside the desktop app.

-- ---------------------------------------------------------------------------
-- Sanity check — run this afterwards; it should list 7 rows.
-- ---------------------------------------------------------------------------
-- select tablename, rowsecurity from pg_tables
--  where schemaname = 'public' and tablename like 'indra\_%';
