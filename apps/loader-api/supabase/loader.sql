-- INDRA LOADER — catalogue and links
--
-- Applied to the shared project (`indra-hub`, ref cztyznuoferktewdhyji) as the
-- migration `loader_catalogue`. Kept here so the schema exists in the repository
-- rather than only in a dashboard, and so a second deployment can be rebuilt from
-- nothing.
--
-- The tables are `loader_*`, not `apps`/`config`. Every other table in that project
-- is `indra_*` and belongs to the hub; two applications, one database, and a prefix
-- is what keeps them apart. Nothing in either app can read the other's rows.
--
-- Safe to run again: every object is created only if it is missing.

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------- apps ----

create table if not exists public.loader_apps (
  id uuid primary key default gen_random_uuid(),

  name text not null check (length(trim(name)) between 1 and 80),
  description text not null default '',
  version text not null default '1.0.0',

  image_url text not null default '',
  exe_url text not null default '',

  -- The product's id in INDRA Auth. Empty means the app is not gated.
  keyauth_app_id text not null default '',

  -- The kill switch: `locked` hides a product from every user, including the ones
  -- who paid for it.
  status text not null default 'active' check (status in ('active', 'locked')),

  -- Optional integrity. When a hash is published the loader deletes a file that
  -- arrives with different bytes instead of installing it.
  exe_sha256 text not null default '',
  exe_bytes bigint not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists loader_apps_created_at_idx on public.loader_apps (created_at asc);

-- --------------------------------------------------------------- config ----

create table if not exists public.loader_config (
  key text primary key,
  value text not null default ''
);

-- ------------------------------------------------------------ updated_at ---

create or replace function public.loader_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists loader_apps_touch on public.loader_apps;
create trigger loader_apps_touch
  before update on public.loader_apps
  for each row execute function public.loader_touch_updated_at();

-- ------------------------------------------------------------------ RLS ----
--
-- Enabled with no policy at all, which is deliberate: the anon key can read
-- nothing and write nothing. Every read and write goes through the API, which holds
-- the service role key on the server.

alter table public.loader_apps enable row level security;
alter table public.loader_config enable row level security;

revoke all on public.loader_apps from anon, authenticated;
revoke all on public.loader_config from anon, authenticated;

-- ---------------------------------------------------------------- seeds ----
--
-- The one link key, and nothing else. No demo apps: an empty catalogue is a true
-- statement about a new install, and a fake one is a lie that ships.

insert into public.loader_config (key, value) values ('website', '')
on conflict (key) do nothing;

-- --------------------------------------------------------------- bucket ----
--
-- Private, 300 MB per file. Nothing has to be made world-readable: the API streams
-- the object itself, so the bucket never needs a public policy.

insert into storage.buckets (id, name, public, file_size_limit)
values ('loader-files', 'loader-files', false, 314572800)
on conflict (id) do nothing;
