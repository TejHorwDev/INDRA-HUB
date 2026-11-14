/*
 * Administering an account — on the server, where the account lives.
 *
 * The console used to change a row in the PC's own SQLite file and call it
 * "deleted". The Supabase account was untouched, so the next sign-in created a
 * fresh local mirror and the person was back, with the same password, on the
 * same machine. Suspension had the same shape: a local flag nobody else saw.
 *
 * Everything here is `security definer` and gates on `indra_is_admin()`, which
 * reads the caller's own JWT against the administrator address table. The app
 * never holds a service key — these four functions are the entire authority it
 * is ever given, and each one refuses on its own if the caller is not the
 * administrator.
 *
 *   indra_admin_delete_account       remove the account for good
 *   indra_admin_set_suspended        ban or unban it in Supabase Auth
 *   indra_admin_reset_password       set its password, with no email round trip
 *   indra_delete_my_account          a person removing their own account
 *
 * Deleting the `auth.users` row is the part that actually matters: with no auth
 * user there is no sign-in, no token, and nothing for the app to mirror. It is
 * also why the profile row is removed first — `indra_users.auth_user_id` is
 * `on delete set null`, so a profile left behind would become an orphan that
 * no longer belongs to anybody.
 */

-- ---------------------------------------------------------------------------
-- The administrator removes somebody else's account
-- ---------------------------------------------------------------------------

create or replace function public.indra_admin_delete_account(p_auth_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  profile_id text;
  owned      int;
begin
  if not public.indra_is_admin() then
    raise exception 'not_an_administrator' using errcode = '42501';
  end if;

  if p_auth_uid is null then
    raise exception 'no_account_given' using errcode = '22023';
  end if;

  -- An administrator deleting their own account through the console would
  -- lock them out of the thing they are holding. Refuse, and say why.
  if p_auth_uid = auth.uid() then
    raise exception 'cannot_delete_yourself' using errcode = '42501';
  end if;

  select id into profile_id from public.indra_users where auth_user_id = p_auth_uid;

  if profile_id is not null then
    /*
     * Same rule the console applies locally: an account that still owns
     * projects is not deleted out from under other people, because the projects
     * would become unreachable for everyone.
     */
    select count(*) into owned from public.indra_projects where owner_id = profile_id;
    if owned > 0 then
      raise exception 'owns_projects' using errcode = 'P0001';
    end if;

    delete from public.indra_project_members where user_id = profile_id;
    delete from public.indra_users where id = profile_id;
  end if;

  delete from auth.users where id = p_auth_uid;

  return jsonb_build_object('deleted', true, 'auth_uid', p_auth_uid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Suspension, in the place that actually refuses a sign-in
-- ---------------------------------------------------------------------------

create or replace function public.indra_admin_set_suspended(p_auth_uid uuid, p_suspended boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.indra_is_admin() then
    raise exception 'not_an_administrator' using errcode = '42501';
  end if;

  if p_auth_uid is null then
    raise exception 'no_account_given' using errcode = '22023';
  end if;

  if p_auth_uid = auth.uid() then
    raise exception 'cannot_suspend_yourself' using errcode = '42501';
  end if;

  update public.indra_users
     set suspended_at = case when p_suspended then coalesce(suspended_at, now()) else null end
   where auth_user_id = p_auth_uid;

  /*
   * The ban is what makes it a fact rather than a note. GoTrue refuses to issue
   * a token to a banned user, so a suspended account cannot sign in on any PC —
   * not the one the administrator used, and not one that has never been online.
   */
  update auth.users
     set banned_until = case when p_suspended then 'infinity'::timestamptz else null end
   where id = p_auth_uid;

  return jsonb_build_object('suspended', p_suspended, 'auth_uid', p_auth_uid);
end;
$$;

-- ---------------------------------------------------------------------------
-- A password reset the person does not have to confirm by email
-- ---------------------------------------------------------------------------

create or replace function public.indra_admin_reset_password(p_auth_uid uuid, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.indra_is_admin() then
    raise exception 'not_an_administrator' using errcode = '42501';
  end if;

  if p_auth_uid is null then
    raise exception 'no_account_given' using errcode = '22023';
  end if;

  if p_password is null or length(p_password) < 8 then
    raise exception 'password_too_short' using errcode = '22023';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at         = now()
   where id = p_auth_uid;

  if not found then
    raise exception 'no_such_account' using errcode = 'P0002';
  end if;

  return jsonb_build_object('reset', true, 'auth_uid', p_auth_uid);
end;
$$;

-- ---------------------------------------------------------------------------
-- A person removing their own account
-- ---------------------------------------------------------------------------

create or replace function public.indra_delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me         uuid := auth.uid();
  profile_id text;
  owned      int;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  select id into profile_id from public.indra_users where auth_user_id = me;

  if profile_id is not null then
    select count(*) into owned from public.indra_projects where owner_id = profile_id;
    if owned > 0 then
      raise exception 'owns_projects' using errcode = 'P0001';
    end if;

    delete from public.indra_project_members where user_id = profile_id;
    delete from public.indra_users where id = profile_id;
  end if;

  /*
   * The caller's own auth row. A security definer function runs as its owner,
   * which is what allows the deletion; the only row it will ever remove is the
   * one whose id is the JWT in the request, so it cannot be aimed at anybody
   * else.
   */
  delete from auth.users where id = me;

  return jsonb_build_object('deleted', true);
end;
$$;

-- Only a signed-in person may call any of these. `anon` never can, and the
-- administrator check inside each function is the second, independent gate.
revoke all on function public.indra_admin_delete_account(uuid) from public, anon;
revoke all on function public.indra_admin_set_suspended(uuid, boolean) from public, anon;
revoke all on function public.indra_admin_reset_password(uuid, text) from public, anon;
revoke all on function public.indra_delete_my_account() from public, anon;

grant execute on function public.indra_admin_delete_account(uuid) to authenticated;
grant execute on function public.indra_admin_set_suspended(uuid, boolean) to authenticated;
grant execute on function public.indra_admin_reset_password(uuid, text) to authenticated;
grant execute on function public.indra_delete_my_account() to authenticated;
