-- ---------------------------------------------------------------------------
-- INDRA HUB — portraits on the workspace server
--
-- Until now a portrait was a file on one PC: `photo:<media id>` pointed at
-- <userData>/media and nothing else could see it. This adds the server half,
-- deliberately without changing what the app already does:
--
--   * the local file stays the source of truth while the person is using it,
--     so setting a picture works with no connection at all;
--   * the upload is best-effort and additive — it can fail without failing the
--     save, and a failed upload leaves the local picture untouched;
--   * the row records only where the bytes live and what they are, never the
--     bytes themselves.
--
-- Storage layout is one folder per Supabase identity:
--
--   indra-media/portraits/<auth uid>/<media id>.<ext>
--
-- The write policy below is what makes that safe: a signed-in person may write
-- only under their own uid, so nobody can overwrite somebody else's face.
--
-- Run after auth.sql and workspace.sql.
-- ---------------------------------------------------------------------------

alter table public.indra_users add column if not exists portrait_path text;
alter table public.indra_users add column if not exists portrait_mime text;
alter table public.indra_users add column if not exists portrait_bytes bigint not null default 0;
alter table public.indra_users add column if not exists portrait_updated_at timestamptz;

-- ---------------------------------------------------------------------------
-- Recording a portrait: the caller's own row, and nobody else's
-- ---------------------------------------------------------------------------

create or replace function public.indra_set_my_portrait(
  p_path  text,
  p_mime  text,
  p_bytes bigint
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid  uuid := auth.uid();
  v_user text;
begin
  if v_uid is null then
    raise exception 'Sign in to the cloud first.';
  end if;

  /* The path has to be this identity's own folder. This is the check that makes
   * "write your own portrait" mean exactly that. */
  if p_path is null or p_path not like 'portraits/' || v_uid::text || '/%' then
    raise exception 'That portrait path is not yours.';
  end if;

  if p_mime is null or p_mime not in ('image/png', 'image/jpeg', 'image/webp') then
    raise exception 'That portrait type is not allowed.';
  end if;

  if p_bytes is null or p_bytes <= 0 or p_bytes > 8388608 then
    raise exception 'That portrait is empty or too large.';
  end if;

  update public.indra_users
     set portrait_path = p_path,
         portrait_mime = p_mime,
         portrait_bytes = p_bytes,
         portrait_updated_at = now()
   where auth_user_id = v_uid
   returning id into v_user;

  if v_user is null then
    raise exception 'This account has no cloud profile yet.';
  end if;

  return jsonb_build_object(
    'userId', v_user,
    'path', p_path,
    'mime', p_mime,
    'bytes', p_bytes,
    'updatedAt', now()
  );
end
$$;

revoke all on function public.indra_set_my_portrait(text, text, bigint) from public;
grant execute on function public.indra_set_my_portrait(text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading a portrait: anyone signed in, by profile id
-- ---------------------------------------------------------------------------

create or replace function public.indra_portrait_of(p_user text)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
           'path', u.portrait_path,
           'mime', u.portrait_mime,
           'bytes', u.portrait_bytes,
           'updatedAt', u.portrait_updated_at
         )
    from public.indra_users u
   where u.id = p_user
     and auth.uid() is not null
$$;

revoke all on function public.indra_portrait_of(text) from public;
grant execute on function public.indra_portrait_of(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: your own folder, and only yours
--
-- The bucket already allows INSERT for the workspace owner (the sign-in video
-- and the developer portrait). These add the one case that belongs to every
-- member rather than only the owner: portraits/<their uid>/*.
-- ---------------------------------------------------------------------------

drop policy if exists indra_portrait_insert on storage.objects;
create policy indra_portrait_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'indra-media'
    and (storage.foldername(name))[1] = 'portraits'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists indra_portrait_update on storage.objects;
create policy indra_portrait_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'indra-media'
    and (storage.foldername(name))[1] = 'portraits'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'indra-media'
    and (storage.foldername(name))[1] = 'portraits'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists indra_portrait_delete on storage.objects;
create policy indra_portrait_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'indra-media'
    and (storage.foldername(name))[1] = 'portraits'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
