/*
 * Changing a project from the console — on the server.
 *
 * A project lives in two places: the working copy in this PC's SQLite file, and
 * the cloud copy that any other machine pulls. The console only ever touched
 * the first one. Deleting a project looked finished until the next sync pulled
 * the cloud copy back; renaming it reverted the same way; transferring it moved
 * a local row that the server still assigned to the old owner.
 *
 * These five functions are the server half. Each is `security definer` and each
 * refuses unless the caller is the administrator, exactly like the account
 * functions — the app still holds no service key, and an ordinary member cannot
 * reach them at all.
 *
 * Children are handled by the schema, not here: `indra_documents`,
 * `indra_presentations` and `indra_project_members` cascade from the project,
 * document versions cascade from the document, and slides cascade from the
 * presentation. So one delete removes the whole tree in one statement.
 */

create or replace function public.indra_admin_delete_project(p_id text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.indra_is_admin() then
    raise exception 'not_an_administrator' using errcode = '42501';
  end if;

  delete from public.indra_projects where id = p_id;
  return found;
end;
$$;

create or replace function public.indra_admin_delete_document(p_id text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.indra_is_admin() then
    raise exception 'not_an_administrator' using errcode = '42501';
  end if;

  delete from public.indra_documents where id = p_id;
  return found;
end;
$$;

create or replace function public.indra_admin_delete_presentation(p_id text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.indra_is_admin() then
    raise exception 'not_an_administrator' using errcode = '42501';
  end if;

  delete from public.indra_presentations where id = p_id;
  return found;
end;
$$;

create or replace function public.indra_admin_rename_project(p_id text, p_name text, p_description text default null)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.indra_is_admin() then
    raise exception 'not_an_administrator' using errcode = '42501';
  end if;

  update public.indra_projects
     set name        = coalesce(nullif(trim(p_name), ''), name),
         description = coalesce(p_description, description),
         updated_at  = now()
   where id = p_id;

  return found;
end;
$$;

/**
 * Moving a project to another person's account.
 *
 * `p_new_owner` is the server profile id (`indra_users.id`), which is what the
 * cloud tables key ownership on — not the Supabase auth id and not the id of a
 * row in somebody's local database.
 */
create or replace function public.indra_admin_transfer_project(p_id text, p_new_owner text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.indra_is_admin() then
    raise exception 'not_an_administrator' using errcode = '42501';
  end if;

  if not exists (select 1 from public.indra_users where id = p_new_owner) then
    raise exception 'no_such_owner' using errcode = 'P0002';
  end if;

  update public.indra_projects
     set owner_id   = p_new_owner,
         updated_at = now()
   where id = p_id;

  return found;
end;
$$;

revoke all on function public.indra_admin_delete_project(text) from public, anon;
revoke all on function public.indra_admin_delete_document(text) from public, anon;
revoke all on function public.indra_admin_delete_presentation(text) from public, anon;
revoke all on function public.indra_admin_rename_project(text, text, text) from public, anon;
revoke all on function public.indra_admin_transfer_project(text, text) from public, anon;

grant execute on function public.indra_admin_delete_project(text) to authenticated;
grant execute on function public.indra_admin_delete_document(text) to authenticated;
grant execute on function public.indra_admin_delete_presentation(text) to authenticated;
grant execute on function public.indra_admin_rename_project(text, text, text) to authenticated;
grant execute on function public.indra_admin_transfer_project(text, text) to authenticated;
