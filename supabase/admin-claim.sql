/*
 * Who is the administrator — decided here, by account, and nowhere else.
 *
 * Until this file, the credit console spoke as a per-installation identity
 * (`device-…@device.indra.hub`), so the role belonged to a PC. Reinstall, and
 * the new identity was not an administrator while the old one still was; the
 * panel said "not granted" and there was no way to argue with it.
 *
 * Now the role lives on a person's profile row, `indra_users.role = 'admin'`,
 * and `indra_is_admin()` (auth.sql) reads it for whoever is signed in. Sign the
 * same account in on another PC and it is an administrator there too, with no
 * button to press.
 *
 * Two rules keep it honest:
 *
 *   - a device identity can never hold or claim the role;
 *   - the first real account to ask, while no account holds it, becomes the
 *     administrator — and every later ask is told who already has it, so the
 *     role is never silently shared or taken.
 *
 * Run after auth.sql and ai-credits.sql.
 */

/* Nothing PC-based keeps the role: device identities are demoted, once. */
update public.indra_users
   set role = 'member'
 where role = 'admin'
   and email like 'device-%@device.indra.hub';

/**
 * The account that runs the console, or null when nobody does yet.
 *
 * Reads only the role — no email of anybody else, nothing that a member could
 * use to enumerate accounts.
 */
create or replace function public.indra_admin_who()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('email', email, 'since', created_at)
    from public.indra_users
   where role = 'admin'
     and email not like 'device-%@device.indra.hub'
   limit 1
$$;

/**
 * Make the signed-in account the administrator — only into an empty chair.
 *
 * Returns the truth either way: `claimed` says whether *this* account now holds
 * it, `adminEmail` names the account that does. A device identity is refused
 * outright, because a device is a machine and the whole point of this file is
 * that machines do not decide this.
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

revoke all on function public.indra_admin_who() from public, anon;
revoke all on function public.indra_admin_claim() from public, anon;
grant execute on function public.indra_admin_who() to authenticated;
grant execute on function public.indra_admin_claim() to authenticated;
