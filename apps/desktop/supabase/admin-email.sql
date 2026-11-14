/*
 * The administrator is an address, decided here, forever.
 *
 * Claiming was a workaround for a question this file answers outright: which
 * account runs the console. The answer is a row in `indra_admin_emails`, and
 * every path below reads it:
 *
 *   - an account whose email is on the list is an administrator the moment its
 *     profile exists — no press, no claim, on every PC it signs in to;
 *   - the role is derived, not stored in a cache, so a reinstall changes
 *     nothing;
 *   - nobody else can take the chair while the list is not empty, so there is
 *     no race to claim it first.
 *
 * Run after auth.sql, ai-credits.sql and admin-claim.sql.
 */

create table if not exists public.indra_admin_emails (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.indra_admin_emails enable row level security;
revoke all on public.indra_admin_emails from anon, authenticated;

insert into public.indra_admin_emails (email, note)
values ('admintej@gmail.com', 'Owner. Permanent administrator.')
on conflict (email) do nothing;

/**
 * Administering is a property of the account.
 *
 * The stored role still counts, because a row may have been promoted before
 * this list existed. The list is what makes it survive a forgotten role.
 */
create or replace function public.indra_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.indra_users u
     where u.auth_user_id = auth.uid()
       and (
         u.role = 'admin'
         or lower(u.email) in (select email from public.indra_admin_emails)
       )
  )
$$;

/**
 * The profile row an account gets is already the right one.
 *
 * Without this, an allowlisted person would be an administrator by
 * `indra_is_admin()` but their row would still say member, and anything that
 * reads the row directly would disagree.
 */
create or replace function public.indra_admin_email_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if lower(new.email) in (select email from public.indra_admin_emails) then
    new.role := 'admin';
  end if;
  return new;
end
$$;

drop trigger if exists indra_admin_email_guard_insert on public.indra_users;
create trigger indra_admin_email_guard_insert
  before insert on public.indra_users
  for each row execute function public.indra_admin_email_guard();

drop trigger if exists indra_admin_email_guard_update on public.indra_users;
create trigger indra_admin_email_guard_update
  before update of email on public.indra_users
  for each row execute function public.indra_admin_email_guard();

/* Any row that already exists for a reserved address is brought in line. */
update public.indra_users u
   set role = 'admin'
 where lower(u.email) in (select email from public.indra_admin_emails)
   and u.role <> 'admin';

/**
 * Who administers, including an address that has not signed up yet.
 *
 * The reserved address is reported as the administrator even before its account
 * exists, so the panel says the truth — "this is run by admintej@gmail.com" —
 * instead of "nobody does", which invited somebody else to claim it.
 */
create or replace function public.indra_admin_who()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ranked as (
    select email, 'reserved'::text as source, created_at
      from public.indra_admin_emails
    union all
    select email, 'role'::text, created_at
      from public.indra_users
     where role = 'admin'
       and email not like 'device-%@device.indra.hub'
       and lower(email) not in (select email from public.indra_admin_emails)
  )
  select jsonb_build_object('email', email, 'since', created_at, 'source', source)
    from ranked
   order by (source = 'reserved') desc, created_at
   limit 1
$$;

/**
 * Claiming survives only as a fallback for a project with an empty list.
 *
 * While the list holds an address, no press can take the chair from it.
 */
create or replace function public.indra_admin_claim()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_me      uuid;
  v_email   text;
  v_reserved text;
  v_admin   uuid;
  v_a_email text;
begin
  if v_uid is null then
    raise exception 'Sign in before claiming administration.';
  end if;

  select id, email into v_me, v_email
    from public.indra_users
   where auth_user_id = v_uid;

  if v_me is null then
    raise exception 'This account has no profile yet.';
  end if;

  if v_email like 'device-%@device.indra.hub' then
    raise exception 'A device cannot be an administrator. Sign in with the account that should run this console.';
  end if;

  select email into v_reserved from public.indra_admin_emails order by created_at limit 1;
  if v_reserved is not null then
    return jsonb_build_object(
      'claimed', lower(v_email) = v_reserved,
      'adminEmail', v_reserved,
      'reason', case when lower(v_email) = v_reserved then null
                     else 'Administration is reserved for ' || v_reserved || '.' end
    );
  end if;

  select id, email into v_admin, v_a_email
    from public.indra_users
   where role = 'admin'
     and email not like 'device-%@device.indra.hub'
   limit 1;

  if v_admin is not null then
    return jsonb_build_object(
      'claimed', v_admin = v_me,
      'adminEmail', v_a_email,
      'reason', case when v_admin = v_me then null
                     else 'Another account already administers this installation.' end
    );
  end if;

  update public.indra_users set role = 'admin' where id = v_me;

  return jsonb_build_object('claimed', true, 'adminEmail', v_email, 'reason', null);
end
$$;

revoke all on function public.indra_is_admin() from public, anon;
revoke all on function public.indra_admin_who() from public, anon;
revoke all on function public.indra_admin_claim() from public, anon;
grant execute on function public.indra_admin_who() to authenticated;
grant execute on function public.indra_admin_claim() to authenticated;
