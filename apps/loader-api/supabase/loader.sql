-- INDRA LOADER — catalogue and links
--
-- Run once against the loader's Supabase project (SQL editor, or `supabase db
-- push`). Safe to run again: every object is created only if it is missing.
--
-- The two tables hold no files. `apps.image_url` and `apps.exe_url` are URLs
-- pointing at object storage; the bytes live in the bucket, never in Postgres.

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------- apps ----

create table if not exists public.apps (
  id uuid primary key default gen_random_uuid(),

  name text not null check (length(trim(name)) between 1 and 80),
  description text not null default '',
  version text not null default '1.0.0',

  image_url text not null default '',
  exe_url text not null default '',

  -- The product's id in INDRA Auth. Empty means the app is not gated and is
  -- available to anyone signed in.
  keyauth_app_id text not null default '',

  -- The kill switch: `locked` hides a product from every user, including the
  -- ones who paid for it.
  status text not null default 'active' check (status in ('active', 'locked')),

  -- Optional integrity. When a hash is published the loader deletes a file that
  -- arrives with different bytes instead of installing it.
  exe_sha256 text not null default '',
  exe_bytes bigint not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The catalogue is read oldest-first, which is the order these are published in.
create index if not exists apps_created_at_idx on public.apps (created_at asc);

-- --------------------------------------------------------------- config ----

create table if not exists public.config (
  key text primary key,
  value text not null default ''
);

-- ------------------------------------------------------------ updated_at ---

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists apps_touch_updated_at on public.apps;
create trigger apps_touch_updated_at
  before update on public.apps
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------ RLS ----
--
-- Enabled with no policy at all, which is deliberate: the anon key can read
-- nothing and write nothing. Every read and write goes through the API, which
-- holds the service role key on the server. If a policy is ever added here by
-- mistake, it is the only thing standing between the internet and the catalogue.

alter table public.apps enable row level security;
alter table public.config enable row level security;

revoke all on public.apps from anon, authenticated;
revoke all on public.config from anon, authenticated;

-- ---------------------------------------------------------------- seeds ----
--
-- The five link keys, and nothing else. No demo apps: an empty catalogue is a
-- true statement about a new install, and a fake one is a lie that ships.

insert into public.config (key, value) values
  ('website', ''),
  ('instagram', ''),
  ('tiktok', ''),
  ('discord', ''),
  ('youtube', '')
on conflict (key) do nothing;
