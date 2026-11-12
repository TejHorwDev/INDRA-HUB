-- ---------------------------------------------------------------------------
-- INDRA HUB — identity and access rules
--
-- Stage 2 of the Supabase plan: real identities (Google, via Supabase Auth) and
-- the Row Level Security that makes a public client key safe. Run once, after
-- supabase/schema.sql. Every statement is guarded, so it can be re-run.
--
-- The rule this file exists to enforce: **the app is never trusted**. Every
-- table below is readable and writable only under a policy that starts from
-- `auth.uid()`. Client code — including a client someone has unpacked and
-- modified — cannot reach a row the policy does not name.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Identity columns
-- ---------------------------------------------------------------------------

alter table public.indra_users add column if not exists member_no text;
alter table public.indra_users add column if not exists role text not null default 'member';

create sequence if not exists public.indra_member_seq;

/*
 * Member numbers: IH-<year of joining>-<running total>
 *
 * Minted once, by the database, when the account is created. Deliberately not
 * derived from a login date — a number that changed every time someone signed
 * in would be worthless as an identifier.
 */
create or replace function public.indra_next_member_no()
returns text
language sql
volatile
as $$
  select 'IH-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.indra_member_seq')::text, 6, '0')
$$;

update public.indra_users set member_no = public.indra_next_member_no() where member_no is null;
alter table public.indra_users alter column member_no set default public.indra_next_member_no();
alter table public.indra_users alter column member_no set not null;
create unique index if not exists indra_users_member_no_key on public.indra_users (member_no);

alter table public.indra_users drop constraint if exists indra_users_role_check;
alter table public.indra_users
  add constraint indra_users_role_check check (role in ('member', 'admin'));

-- ---------------------------------------------------------------------------
-- 2. Helpers
--
-- All `security definer`, all with a pinned search_path, all answering a single
-- question. Policies read as sentences because of them.
-- ---------------------------------------------------------------------------

/** The profile id of the caller, or null when the caller is not signed in. */
create or replace function public.indra_uid()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id from public.indra_users u where u.auth_user_id = auth.uid() limit 1
$$;

create or replace function public.indra_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.indra_users u
     where u.auth_user_id = auth.uid() and u.role = 'admin'
  )
$$;

/** True when the caller owns the project or sits on it as a member. */
create or replace function public.indra_in_project(target text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.indra_projects p
     where p.id = target and p.owner_id = public.indra_uid()
  ) or exists (
    select 1 from public.indra_project_members m
     where m.project_id = target and m.user_id = public.indra_uid()
  )
$$;

create or replace function public.indra_owns_project(target text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.indra_projects p
     where p.id = target and p.owner_id = public.indra_uid()
  )
$$;

create or replace function public.indra_document_project(document_id text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select d.project_id from public.indra_documents d where d.id = document_id $$;

create or replace function public.indra_presentation_project(presentation_id text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select p.project_id from public.indra_presentations p where p.id = presentation_id $$;

create or replace function public.indra_slide_project(slide_id text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.project_id
    from public.indra_presentation_slides s
    join public.indra_presentations p on p.id = s.presentation_id
   where s.id = slide_id
$$;

-- ---------------------------------------------------------------------------
-- 3. Profile creation
--
-- A Google sign-in creates an `auth.users` row. This turns that into a profile
-- with a member number, so nobody has to race the client to create it.
-- ---------------------------------------------------------------------------

create or replace function public.indra_create_profile(auth_id uuid, email text, full_name text)
returns public.indra_users
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  profile public.indra_users;
  base text;
  candidate text;
  counter int := 0;
begin
  select * into profile from public.indra_users where auth_user_id = auth_id;
  if found then
    return profile;
  end if;

  -- A readable handle from the address, made unique with a numeric suffix.
  base := lower(regexp_replace(split_part(coalesce(email, ''), '@', 1), '[^a-zA-Z0-9_-]', '', 'g'));
  if base is null or base = '' then
    base := 'user';
  end if;
  base := substr(base, 1, 20);

  candidate := base;
  while exists (select 1 from public.indra_users where username = candidate) loop
    counter := counter + 1;
    candidate := substr(base, 1, 18) || counter::text;
    if counter > 500 then
      candidate := substr(base, 1, 12) || floor(random() * 1000000)::text;
      exit;
    end if;
  end loop;

  insert into public.indra_users (id, auth_user_id, username, display_name, email, created_at, last_sign_in_at)
  values (
    gen_random_uuid()::text,
    auth_id,
    candidate,
    coalesce(
      nullif(trim(full_name), ''),
      nullif(trim(initcap(replace(candidate, '_', ' '))), ''),
      candidate
    ),
    coalesce(email, ''),
    now(),
    now()
  )
  returning * into profile;

  return profile;
end;
$$;

/**
 * Runs on every new Supabase Auth user. It must never be able to block sign-in,
 * so a failure is reported and swallowed: `indra_ensure_profile()` below repairs
 * anything this misses, the first time the user actually opens the app.
 */
create or replace function public.indra_on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.indra_create_profile(
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  );
  return new;
exception
  when others then
    raise warning 'indra: could not create profile for %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists indra_on_auth_user_created on auth.users;
create trigger indra_on_auth_user_created
  after insert on auth.users
  for each row execute function public.indra_on_auth_user_created();

create or replace function public.indra_ensure_profile()
returns public.indra_users
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  account auth.users;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select * into account from auth.users where id = auth.uid();
  if not found then
    raise exception 'no account for this session';
  end if;

  return public.indra_create_profile(
    account.id,
    account.email,
    coalesce(account.raw_user_meta_data ->> 'full_name', account.raw_user_meta_data ->> 'name')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------------

-- Profiles: you see yourself. Admins see everyone. Nobody browses the table.
drop policy if exists indra_users_select_self on public.indra_users;
create policy indra_users_select_self on public.indra_users
  for select to authenticated
  using (auth_user_id = auth.uid() or public.indra_is_admin());

-- You may edit your own row; the column grants below decide *which* columns.
drop policy if exists indra_users_update_self on public.indra_users;
create policy indra_users_update_self on public.indra_users
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- No client-side insert, delete or role change: profiles belong to the server.

-- Projects.
drop policy if exists indra_projects_select on public.indra_projects;
create policy indra_projects_select on public.indra_projects
  for select to authenticated
  using (public.indra_in_project(id));

drop policy if exists indra_projects_insert on public.indra_projects;
create policy indra_projects_insert on public.indra_projects
  for insert to authenticated
  with check (owner_id = public.indra_uid());

drop policy if exists indra_projects_update on public.indra_projects;
create policy indra_projects_update on public.indra_projects
  for update to authenticated
  using (public.indra_owns_project(id))
  with check (public.indra_owns_project(id));

drop policy if exists indra_projects_delete on public.indra_projects;
create policy indra_projects_delete on public.indra_projects
  for delete to authenticated
  using (public.indra_owns_project(id));

-- Membership: members see the roster; only the owner changes it; anyone may
-- remove themselves (leaving a project is not a privilege).
drop policy if exists indra_members_select on public.indra_project_members;
create policy indra_members_select on public.indra_project_members
  for select to authenticated
  using (public.indra_in_project(project_id));

drop policy if exists indra_members_insert on public.indra_project_members;
create policy indra_members_insert on public.indra_project_members
  for insert to authenticated
  with check (public.indra_owns_project(project_id));

drop policy if exists indra_members_delete on public.indra_project_members;
create policy indra_members_delete on public.indra_project_members
  for delete to authenticated
  using (public.indra_owns_project(project_id) or user_id = public.indra_uid());

-- Documents.
drop policy if exists indra_documents_select on public.indra_documents;
create policy indra_documents_select on public.indra_documents
  for select to authenticated
  using (public.indra_in_project(project_id));

drop policy if exists indra_documents_insert on public.indra_documents;
create policy indra_documents_insert on public.indra_documents
  for insert to authenticated
  with check (public.indra_in_project(project_id));

drop policy if exists indra_documents_update on public.indra_documents;
create policy indra_documents_update on public.indra_documents
  for update to authenticated
  using (public.indra_in_project(project_id))
  with check (public.indra_in_project(project_id));

drop policy if exists indra_documents_delete on public.indra_documents;
create policy indra_documents_delete on public.indra_documents
  for delete to authenticated
  using (public.indra_owns_project(project_id) or created_by = public.indra_uid());

-- Document versions.
drop policy if exists indra_versions_select on public.indra_document_versions;
create policy indra_versions_select on public.indra_document_versions
  for select to authenticated
  using (public.indra_in_project(public.indra_document_project(document_id)));

drop policy if exists indra_versions_insert on public.indra_document_versions;
create policy indra_versions_insert on public.indra_document_versions
  for insert to authenticated
  with check (public.indra_in_project(public.indra_document_project(document_id)));

-- History is append-only from a client's point of view.

-- Presentations.
drop policy if exists indra_presentations_select on public.indra_presentations;
create policy indra_presentations_select on public.indra_presentations
  for select to authenticated
  using (public.indra_in_project(project_id));

drop policy if exists indra_presentations_insert on public.indra_presentations;
create policy indra_presentations_insert on public.indra_presentations
  for insert to authenticated
  with check (public.indra_in_project(project_id));

drop policy if exists indra_presentations_update on public.indra_presentations;
create policy indra_presentations_update on public.indra_presentations
  for update to authenticated
  using (public.indra_in_project(project_id))
  with check (public.indra_in_project(project_id));

drop policy if exists indra_presentations_delete on public.indra_presentations;
create policy indra_presentations_delete on public.indra_presentations
  for delete to authenticated
  using (public.indra_owns_project(project_id) or created_by = public.indra_uid());

-- Slides belong to a presentation, which belongs to a project.
drop policy if exists indra_slides_select on public.indra_presentation_slides;
create policy indra_slides_select on public.indra_presentation_slides
  for select to authenticated
  using (public.indra_in_project(public.indra_slide_project(id)));

drop policy if exists indra_slides_insert on public.indra_presentation_slides;
create policy indra_slides_insert on public.indra_presentation_slides
  for insert to authenticated
  with check (public.indra_in_project(public.indra_presentation_project(presentation_id)));

drop policy if exists indra_slides_update on public.indra_presentation_slides;
create policy indra_slides_update on public.indra_presentation_slides
  for update to authenticated
  using (public.indra_in_project(public.indra_presentation_project(presentation_id)))
  with check (public.indra_in_project(public.indra_presentation_project(presentation_id)));

drop policy if exists indra_slides_delete on public.indra_presentation_slides;
create policy indra_slides_delete on public.indra_presentation_slides
  for delete to authenticated
  using (public.indra_in_project(public.indra_presentation_project(presentation_id)));

-- ---------------------------------------------------------------------------
-- 5. Column grants
--
-- A policy says which *rows* you may write. These say which *columns* — so
-- nobody can PATCH their own role, member number or account link even if a
-- policy ever let the row through.
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.indra_users from authenticated;
grant update (username, display_name) on public.indra_users to authenticated;

revoke update on public.indra_projects from authenticated;
grant update (name, description, updated_at) on public.indra_projects to authenticated;

revoke update on public.indra_project_members from authenticated;

revoke update on public.indra_documents from authenticated;
grant update (title, content, version, updated_by, updated_at) on public.indra_documents to authenticated;

revoke update, delete on public.indra_document_versions from authenticated;

-- ---------------------------------------------------------------------------
-- 6. Lookups for teams
--
-- Adding someone by member number must not require reading the whole users
-- table. These two functions return exactly what a picker needs — never an
-- email address — and nothing else.
-- ---------------------------------------------------------------------------

create or replace function public.indra_find_member(p_query text)
returns table (id text, member_no text, username text, display_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.member_no, u.username, u.display_name
    from public.indra_users u
   where public.indra_uid() is not null
     and u.id <> coalesce(public.indra_uid(), '')
     and (
       upper(u.member_no) = upper(trim(p_query))
       or lower(u.username) = lower(trim(p_query))
     )
   limit 5
$$;

create or replace function public.indra_project_roster(p_project_id text)
returns table (id text, member_no text, username text, display_name text, is_owner boolean, joined_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.member_no, u.username, u.display_name, (p.owner_id = u.id), m.joined_at
    from public.indra_project_members m
    join public.indra_projects p on p.id = m.project_id
    join public.indra_users u on u.id = m.user_id
   where m.project_id = p_project_id
     and public.indra_in_project(p_project_id)
$$;

-- ---------------------------------------------------------------------------
-- 7. The first administrator
--
-- There is exactly one administrator and no default credential. The first
-- signed-in person to claim it takes it; after that the call returns false for
-- everyone. With signup gated by an activation key, "first" means "you".
-- ---------------------------------------------------------------------------

create or replace function public.indra_claim_admin()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me text := public.indra_uid();
begin
  if me is null then
    raise exception 'sign in first';
  end if;

  if exists (select 1 from public.indra_users where role = 'admin') then
    return false;
  end if;

  update public.indra_users set role = 'admin' where id = me;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Execution rights
--
-- Everything above is closed by default: only a signed-in user may call it.
-- ---------------------------------------------------------------------------

revoke all on function public.indra_next_member_no() from public, anon, authenticated;
revoke all on function public.indra_create_profile(uuid, text, text) from public, anon, authenticated;
revoke all on function public.indra_on_auth_user_created() from public, anon, authenticated;
revoke all on function public.indra_uid() from public, anon;
revoke all on function public.indra_is_admin() from public, anon;
revoke all on function public.indra_in_project(text) from public, anon;
revoke all on function public.indra_owns_project(text) from public, anon;
revoke all on function public.indra_document_project(text) from public, anon;
revoke all on function public.indra_presentation_project(text) from public, anon;
revoke all on function public.indra_slide_project(text) from public, anon;
revoke all on function public.indra_find_member(text) from public, anon;
revoke all on function public.indra_project_roster(text) from public, anon;
revoke all on function public.indra_claim_admin() from public, anon;
revoke all on function public.indra_ensure_profile() from public, anon;

grant execute on function public.indra_uid() to authenticated;
grant execute on function public.indra_is_admin() to authenticated;
grant execute on function public.indra_in_project(text) to authenticated;
grant execute on function public.indra_owns_project(text) to authenticated;
grant execute on function public.indra_document_project(text) to authenticated;
grant execute on function public.indra_presentation_project(text) to authenticated;
grant execute on function public.indra_slide_project(text) to authenticated;
grant execute on function public.indra_find_member(text) to authenticated;
grant execute on function public.indra_project_roster(text) to authenticated;
grant execute on function public.indra_claim_admin() to authenticated;
grant execute on function public.indra_ensure_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- Sanity check — run afterwards. Seven tables, each with at least one policy.
-- ---------------------------------------------------------------------------
-- select tablename, count(*) as policies from pg_policies
--  where schemaname = 'public' and tablename like 'indra\_%'
--  group by tablename order by tablename;
