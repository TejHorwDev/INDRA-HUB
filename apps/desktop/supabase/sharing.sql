-- ---------------------------------------------------------------------------
-- INDRA HUB — sharing a project with somebody on another PC
--
-- Stage 3 of the Supabase plan. Run after schema.sql and auth.sql. Every
-- statement is guarded, so it can be re-run without harm.
--
-- What was missing
-- ----------------
-- The policies in auth.sql already let a *member* of a project read and write
-- its documents and decks. What did not exist was a way for two people who have
-- never met this database to become owner and member in the first place:
-- projects were pushed by one installation's private identity, and no client
-- could look another person up.
--
-- The rule this file adds: **an invitation is addressed to an email, and only
-- the account that owns that email can answer it.** Nobody can browse the
-- account table, and asking somebody never reveals whether their address is
-- registered — the invitation is a row, not a lookup.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. A profile can say who the person is
--
-- `email` is the identity's own generated address (unique, never shown).
-- `contact_email` is the address the person registered with on their PC, and
-- the one invitations are addressed to. It is not unique: one person may have
-- an installation at home and another at college.
-- ---------------------------------------------------------------------------

alter table public.indra_users add column if not exists contact_email text;

create index if not exists indra_users_contact_idx
  on public.indra_users (lower(contact_email))
  where contact_email is not null;

-- Profiles remain un-editable except for the three columns that describe a
-- person rather than an account. `contact_email` is one of them.
revoke update on public.indra_users from authenticated;
grant update (username, display_name, contact_email) on public.indra_users to authenticated;

/** The address this caller answers invitations at, normalised. */
create or replace function public.indra_my_contact_email()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select lower(nullif(trim(coalesce(u.contact_email, u.email)), ''))
    from public.indra_users u
   where u.auth_user_id = auth.uid()
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- 2. Invitations
--
-- A pending invitation per project and address. History is kept, so the owner
-- can tell "declined" from "never answered" — the same distinction the local
-- invitations make.
-- ---------------------------------------------------------------------------

create table if not exists public.indra_project_invites (
  id           text primary key,
  project_id   text not null references public.indra_projects (id) on delete cascade,
  email        text not null,
  invited_by   text not null references public.indra_users (id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz
);

create unique index if not exists indra_invites_pending_key
  on public.indra_project_invites (project_id, lower(email))
  where status = 'pending';

create index if not exists indra_invites_email_idx
  on public.indra_project_invites (lower(email), status);

create index if not exists indra_invites_project_idx
  on public.indra_project_invites (project_id, status);

alter table public.indra_project_invites enable row level security;

-- No policies: the table is reached only through the functions below, each of
-- which checks the caller itself. A client that guesses an id gains nothing.
revoke all on public.indra_project_invites from authenticated;

-- ---------------------------------------------------------------------------
-- 3. The three acts
-- ---------------------------------------------------------------------------

/**
 * Ask an address to join a project. Only the head developer may ask, and asking
 * the same address twice is a no-op rather than an error the screen has to
 * explain twice.
 */
create or replace function public.indra_invite_to_project(p_project text, p_email text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_existing text;
  v_id text;
begin
  if public.indra_uid() is null then
    raise exception 'Sign in to the cloud first.';
  end if;
  if not public.indra_owns_project(p_project) then
    raise exception 'Only the head developer can invite people to this project.';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That is not an email address.';
  end if;

  select i.id into v_existing
    from public.indra_project_invites i
   where i.project_id = p_project and lower(i.email) = v_email and i.status = 'pending'
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  v_id := gen_random_uuid()::text;
  insert into public.indra_project_invites (id, project_id, email, invited_by)
  values (v_id, p_project, v_email, public.indra_uid());
  return v_id;
end
$$;

/**
 * What is waiting for me, on any project, on any PC.
 *
 * Matched on the address, so this reveals nothing about who else is registered
 * — only rows somebody addressed to this caller.
 */
create or replace function public.indra_my_invites()
returns table (
  id text,
  project_id text,
  project_name text,
  invited_by_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id,
         p.id,
         p.name,
         coalesce(u.display_name, 'Somebody'),
         i.created_at
    from public.indra_project_invites i
    join public.indra_projects p on p.id = i.project_id
    left join public.indra_users u on u.id = i.invited_by
   where i.status = 'pending'
     and lower(i.email) = public.indra_my_contact_email()
   order by i.created_at desc
$$;

/**
 * Answer an invitation.
 *
 * Acceptance is the only thing that writes a membership, and it writes exactly
 * one row: the caller's. Declining writes no membership and keeps the row as a
 * record. Both are guarded by the address, not by the invitation id alone.
 */
create or replace function public.indra_answer_invite(p_id text, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.indra_project_invites;
  v_me text := public.indra_uid();
  v_email text := public.indra_my_contact_email();
begin
  if v_me is null then
    raise exception 'Sign in to the cloud first.';
  end if;

  select * into v_invite
    from public.indra_project_invites i
   where i.id = p_id
     for update;
  if not found then
    raise exception 'That invitation no longer exists.';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'That invitation has already been answered.';
  end if;
  if v_email is null or lower(v_invite.email) <> v_email then
    raise exception 'That invitation is not addressed to this account.';
  end if;

  if p_accept then
    if exists (
      select 1 from public.indra_projects p
       where p.id = v_invite.project_id and p.owner_id = v_me
    ) then
      -- The owner answering their own invitation: close it, join nothing.
      update public.indra_project_invites
         set status = 'accepted', responded_at = now()
       where id = p_id;
      return 'accepted';
    end if;

    insert into public.indra_project_members (project_id, user_id, role)
    values (v_invite.project_id, v_me, 'member')
    on conflict (project_id, user_id) do nothing;

    update public.indra_project_invites
       set status = 'accepted', responded_at = now()
     where id = p_id;
    return 'accepted';
  end if;

  update public.indra_project_invites
     set status = 'declined', responded_at = now()
   where id = p_id;
  return 'declined';
end
$$;

/**
 * Take a question back. The owner of the project may revoke any pending
 * invitation on it; nobody else may.
 */
create or replace function public.indra_cancel_invite(p_id text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project text;
begin
  select i.project_id into v_project
    from public.indra_project_invites i
   where i.id = p_id and i.status = 'pending';
  if v_project is null then
    return false;
  end if;
  if not public.indra_owns_project(v_project) then
    raise exception 'Only the head developer can take an invitation back.';
  end if;

  update public.indra_project_invites
     set status = 'revoked', responded_at = now()
   where id = p_id;
  return true;
end
$$;

/**
 * Everyone who can open a project, with how they got in.
 *
 * A member needs the roster to build the same picture on their own PC; the
 * table-level policy on indra_users only lets a person read their own profile,
 * so this is the one window into it, and it opens only for people already on
 * the project.
 */
create or replace function public.indra_project_people(p_project text)
returns table (
  id text,
  member_no text,
  username text,
  display_name text,
  is_owner boolean,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.member_no, u.username, u.display_name,
         (p.owner_id = u.id) as is_owner,
         coalesce(m.joined_at, p.created_at) as joined_at
    from public.indra_projects p
    join public.indra_users u
      on u.id = p.owner_id
      or u.id in (select mm.user_id from public.indra_project_members mm
                   where mm.project_id = p.id)
    left join public.indra_project_members m
      on m.project_id = p.id and m.user_id = u.id
   where p.id = p_project
     and public.indra_in_project(p_project)
$$;

/**
 * The projects this account can open — owned or shared with it. `owner_name`
 * lets a member show whose project it is without reading the profile table.
 */
create or replace function public.indra_my_projects()
returns table (
  id text,
  name text,
  description text,
  owner_id text,
  owner_name text,
  is_owner boolean,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.name, p.description, p.owner_id,
         coalesce(u.display_name, 'Unknown'),
         (p.owner_id = public.indra_uid()),
         p.updated_at
    from public.indra_projects p
    left join public.indra_users u on u.id = p.owner_id
   where public.indra_in_project(p.id)
   order by p.updated_at desc
$$;

/**
 * The pending questions the owner is waiting on, for the project's own screen.
 */
create or replace function public.indra_project_invites_for(p_project text)
returns table (id text, email text, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id, i.email, i.created_at
    from public.indra_project_invites i
   where i.project_id = p_project
     and i.status = 'pending'
     and public.indra_owns_project(p_project)
   order by i.created_at asc
$$;

-- ---------------------------------------------------------------------------
-- 4. Execution rights
-- ---------------------------------------------------------------------------

grant execute on function public.indra_my_contact_email() to authenticated;
grant execute on function public.indra_invite_to_project(text, text) to authenticated;
grant execute on function public.indra_my_invites() to authenticated;
grant execute on function public.indra_answer_invite(text, boolean) to authenticated;
grant execute on function public.indra_cancel_invite(text) to authenticated;
grant execute on function public.indra_project_people(text) to authenticated;
grant execute on function public.indra_my_projects() to authenticated;
grant execute on function public.indra_project_invites_for(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Sanity check — this should list four functions and one table.
-- ---------------------------------------------------------------------------
-- select proname from pg_proc
--  where proname in ('indra_invite_to_project', 'indra_my_invites',
--                    'indra_answer_invite', 'indra_cancel_invite');
-- select tablename, rowsecurity from pg_tables
--  where schemaname = 'public' and tablename = 'indra_project_invites';
