
-- Workspace: the single row every installation reads.
create table if not exists public.indra_workspace (
  id text primary key,
  owner_uid uuid,
  revision bigint not null default 1,
  allow_registration boolean not null default true,
  maintenance boolean not null default false,
  maintenance_message text not null default 'INDRA HUB is temporarily unavailable while maintenance is carried out.',
  require_activation_key boolean not null default false,
  background_asset_id text,
  background_mime text,
  background_bytes bigint not null default 0,
  background_path text,
  background_blur smallint not null default 18,
  background_dim smallint not null default 46,
  claim_hash text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint indra_workspace_singleton check (id = 'primary'),
  constraint indra_workspace_blur_range check (background_blur between 0 and 40),
  constraint indra_workspace_dim_range check (background_dim between 0 and 92),
  constraint indra_workspace_message_len check (char_length(maintenance_message) between 1 and 400),
  constraint indra_workspace_background check (
    (background_asset_id is null and background_path is null and background_mime is null and background_bytes = 0)
    or (
      background_asset_id is not null
      and background_path is not null
      and background_mime in ('video/mp4', 'video/webm', 'video/x-m4v', 'video/ogg')
      and background_bytes between 1 and 100663296
    )
  )
);

alter table public.indra_workspace replica identity full;

create or replace function public.indra_workspace_touch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  new.owner_uid := coalesce(old.owner_uid, new.owner_uid);
  return new;
end;
$$;

drop trigger if exists indra_workspace_touch on public.indra_workspace;
create trigger indra_workspace_touch
before update on public.indra_workspace
for each row execute function public.indra_workspace_touch();

alter table public.indra_workspace enable row level security;

drop policy if exists indra_workspace_read on public.indra_workspace;
create policy indra_workspace_read on public.indra_workspace
  for select to anon, authenticated using (true);

drop policy if exists indra_workspace_write on public.indra_workspace;
create policy indra_workspace_write on public.indra_workspace
  for update to authenticated
  using (owner_uid is not null and owner_uid = auth.uid())
  with check (owner_uid = auth.uid());

revoke all on public.indra_workspace from anon, authenticated;
grant select on public.indra_workspace to anon, authenticated;
grant update (
  allow_registration, maintenance, maintenance_message, require_activation_key,
  background_asset_id, background_mime, background_bytes, background_path,
  background_blur, background_dim
) on public.indra_workspace to authenticated;

create or replace function public.indra_is_workspace_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.indra_workspace w
     where w.id = 'primary' and w.owner_uid = auth.uid()
  )
$$;

create or replace function public.indra_claim_workspace(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_rows integer;
begin
  if v_uid is null then
    raise exception 'Sign in before claiming the workspace.' using errcode = '28000';
  end if;

  update public.indra_workspace
     set owner_uid = v_uid,
         claim_hash = null
   where id = 'primary'
     and owner_uid is null
     and claim_hash is not null
     and claim_hash = encode(sha256((coalesce(p_code, '') || 'indra-claim-v1')::bytea), 'hex');

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.indra_claim_workspace(text) from public, anon;
revoke all on function public.indra_is_workspace_owner() from public, anon;
grant execute on function public.indra_claim_workspace(text) to authenticated;
grant execute on function public.indra_is_workspace_owner() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('indra-media', 'indra-media', false, 100663296,
        array['video/mp4', 'video/webm', 'video/x-m4v', 'video/ogg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists indra_media_read on storage.objects;
create policy indra_media_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'indra-media');

drop policy if exists indra_media_insert on storage.objects;
create policy indra_media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'indra-media' and public.indra_is_workspace_owner());

drop policy if exists indra_media_update on storage.objects;
create policy indra_media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'indra-media' and public.indra_is_workspace_owner())
  with check (bucket_id = 'indra-media' and public.indra_is_workspace_owner());

drop policy if exists indra_media_delete on storage.objects;
create policy indra_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'indra-media' and public.indra_is_workspace_owner());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'indra_workspace'
  ) then
    execute 'alter publication supabase_realtime add table public.indra_workspace';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The row, and the one-time setup code that decides who may own it.
--
-- Generate a long random code (for example IH-XXXX-XXXX-XXXX-XXXX), keep it
-- somewhere safe, and paste the SHA-256 of `<code> + 'indra-claim-v1'` below:
--
--   node -e "const c=require('crypto');const code='IH-REPLACE-ME';\
--   console.log(c.createHash('sha256').update(code+'indra-claim-v1').digest('hex'))"
--
-- Only the hash is stored. The app shows a setup-code field until an account
-- claims the row, and the hash is cleared the moment it is used.
-- ---------------------------------------------------------------------------
insert into public.indra_workspace (id, claim_hash)
values ('primary', '<sha256 of the setup code>')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- The read-only view every installation uses.
--
-- It hides the claim hash, and answers "is this row mine?" for the caller
-- instead of publishing the owner's uuid. `security_invoker` keeps RLS in
-- force, so the view can never show more than the table would.
-- ---------------------------------------------------------------------------
create or replace view public.indra_workspace_state
with (security_invoker = true) as
select
  w.id,
  w.revision,
  w.allow_registration,
  w.maintenance,
  w.maintenance_message,
  w.require_activation_key,
  w.background_asset_id,
  w.background_mime,
  w.background_bytes,
  w.background_path,
  w.background_blur,
  w.background_dim,
  w.updated_at,
  (w.owner_uid is not null) as owned,
  (w.owner_uid is not null and w.owner_uid = auth.uid()) as owned_by_me,
  (w.claim_hash is not null) as claimable
from public.indra_workspace w;

revoke all on public.indra_workspace_state from anon, authenticated;
grant select on public.indra_workspace_state to anon, authenticated;
