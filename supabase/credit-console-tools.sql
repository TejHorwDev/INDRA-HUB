-- ---------------------------------------------------------------------------
-- INDRA HUB — the credit console's tools, and the repairs it needed
--
-- Run after credit-console.sql.
--
-- This file is the console's second half. The first half gave an administrator
-- the pricing rules; this one gives them the accounts themselves: the whole
-- fleet's movement log, one account in full, suspension, an immediate refill,
-- and a way back when the role has never been handed out.
--
-- Every function here is `security definer` and starts by asking
-- `indra_is_admin()` — the browser holds no privileges of its own, so a call
-- that is not from a signed-in administrator fails at the server, not in the
-- console's React tree.
--
-- Three defects were found by running these against the live project rather
-- than reading them, and are fixed here rather than worked around in the app:
--
--   1. `indra_admin_accounts()` declared `daily`, `purchased` and `total` as
--      bigint, but sums the two columns before adding them, which Postgres
--      types as integer. PL/pgSQL refuses that at call time (42804), so the
--      console's account list never loaded — the panel would have shown
--      "Sign in to continue." over a perfectly valid administrator session.
--   2. The first `indra_claim_credit_admin()` picked "the" administrator with
--      `limit 1` and no ordering. Once the caller was an administrator, that
--      SELECT could return the caller's own row, which is not `<> v_me`, so the
--      guard passed and the normalisation then demoted the caller — leaving the
--      project with no administrator at all. The rule now says what it means:
--      refuse if a *different, active* administrator exists.
--   3. The same function verified its own work through `indra_is_admin()`,
--      which is `stable` and could still answer from the snapshot taken before
--      the update. A claim that had succeeded reported `claimed: false`, which
--      the console shows as a refusal. It reads the row it just wrote instead.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The account list, with the column types it actually returns
-- ---------------------------------------------------------------------------

create or replace function public.indra_admin_accounts(p_query text default '')
returns table (
  id text,
  display_name text,
  username text,
  email text,
  plan text,
  plan_name text,
  daily bigint,
  purchased bigint,
  total bigint,
  requests bigint,
  plan_expires_at timestamptz,
  last_sign_in_at timestamptz,
  suspended_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_query text := lower(trim(coalesce(p_query, '')));
begin
  if not public.indra_is_admin() then raise exception 'Only an administrator can list accounts.'; end if;
  return query
  select u.id, u.display_name, u.username, u.email, u.plan, p.name,
         u.daily_balance::bigint, u.purchased_balance::bigint,
         (u.daily_balance + u.purchased_balance)::bigint, u.ai_requests::bigint,
         u.plan_expires_at, u.last_sign_in_at, u.suspended_at
    from public.indra_users u
    left join public.indra_plans p on p.id = u.plan
   where v_query = ''
      or lower(coalesce(u.display_name, '')) like '%' || v_query || '%'
      or lower(coalesce(u.username, '')) like '%' || v_query || '%'
      or lower(coalesce(u.email, '')) like '%' || v_query || '%'
   order by u.created_at desc
   limit 200;
end $$;

revoke all on function public.indra_admin_accounts(text) from public, anon;
grant execute on function public.indra_admin_accounts(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Suspend, and restore
-- ---------------------------------------------------------------------------
-- Suspension is a column, not a deleted row: the account keeps its credits and
-- its history, and every path that spends or reads a balance refuses while it
-- is set. An administrator cannot suspend themselves, which is the difference
-- between a locked door and locking yourself out.

create or replace function public.indra_admin_set_suspended(p_user text, p_suspended boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.indra_is_admin() then raise exception 'Only an administrator can suspend an account.'; end if;
  if p_user = public.indra_uid() then
    raise exception 'An administrator cannot suspend their own account.';
  end if;

  update public.indra_users
     set suspended_at = case when p_suspended then now() else null end
   where id = p_user;

  if not found then raise exception 'No such account.'; end if;
  return jsonb_build_object('ok', true, 'suspended', p_suspended);
end $$;

revoke all on function public.indra_admin_set_suspended(text, boolean) from public, anon;
grant execute on function public.indra_admin_set_suspended(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Refill every daily allowance, now
-- ---------------------------------------------------------------------------
-- The cron job does this at 00:05 UTC. This is for the administrator who has
-- just changed what a tier is worth and should not have to wait a day. It is
-- idempotent: `indra_ensure_credit_day` leaves an account that was already
-- refilled today alone, so pressing it twice refills nothing the second time.

create or replace function public.indra_admin_reset_daily()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row   record;
  v_count integer := 0;
begin
  if not public.indra_is_admin() then raise exception 'Only an administrator can refill allowances.'; end if;

  for v_row in select id from public.indra_users loop
    begin
      perform public.indra_ensure_credit_day(v_row.id);
      v_count := v_count + 1;
    exception when others then
      -- One bad row must not stop the other ninety-nine from being refilled.
      null;
    end;
  end loop;

  return v_count;
end $$;

revoke all on function public.indra_admin_reset_daily() from public, anon;
grant execute on function public.indra_admin_reset_daily() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Every movement, every account
-- ---------------------------------------------------------------------------
-- One page of the fleet's ledger, newest first, with the account's name beside
-- each line so the console table does not have to look each id up.

create or replace function public.indra_admin_spend_log(p_limit integer default 50)
returns table (
  id text,
  user_id text,
  display_name text,
  kind text,
  amount bigint,
  balance_after bigint,
  meta jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.indra_is_admin() then raise exception 'Only an administrator can read the fleet log.'; end if;
  return query
  select l.id, l.user_id, coalesce(u.display_name, u.username, 'Member'),
         l.kind, l.amount, l.balance_after, l.meta, l.created_at
    from public.indra_credit_ledger l
    left join public.indra_users u on u.id = l.user_id
   order by l.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

revoke all on function public.indra_admin_spend_log(integer) from public, anon;
grant execute on function public.indra_admin_spend_log(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. One account, with its own history and its own refill clock
-- ---------------------------------------------------------------------------
-- `credits_reset_at` is the authority for when this account's daily allowance
-- comes back. It is not the same instant for every account once a tier has been
-- introduced mid-day, so the console states the account's clock, not a policy.

create or replace function public.indra_admin_account(p_user text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_log jsonb;
begin
  if not public.indra_is_admin() then raise exception 'Only an administrator can inspect an account.'; end if;

  select to_jsonb(t) into v_row from (
    select u.id, u.display_name, u.username, u.email, u.plan, p.name as plan_name,
           u.daily_balance as daily, u.purchased_balance as purchased,
           (u.daily_balance + u.purchased_balance)::bigint as total,
           u.ai_requests as requests, u.plan_expires_at, u.last_sign_in_at, u.suspended_at,
           u.created_at, u.member_no, u.credits_reset_at, u.role
      from public.indra_users u
      left join public.indra_plans p on p.id = u.plan
     where u.id = p_user
  ) t;

  if v_row is null then raise exception 'No such account.'; end if;

  select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc), '[]'::jsonb) into v_log
    from (select id, kind, amount, balance_after, meta, created_at
            from public.indra_credit_ledger
           where user_id = p_user
           order by created_at desc
           limit 100) l;

  return jsonb_build_object('account', v_row, 'ledger', v_log);
end $$;

revoke all on function public.indra_admin_account(text) from public, anon;
grant execute on function public.indra_admin_account(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The refill clock, and how many accounts there really are
-- ---------------------------------------------------------------------------
-- The account list is capped at 200, so its length is not the count. A console
-- that said "200 accounts" because it received 200 rows would be lying about a
-- fleet of 400.

create or replace function public.indra_credit_reset_info()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next timestamptz;
  v_last timestamptz;
  v_job  text;
begin
  if not public.indra_is_admin() then raise exception 'Only an administrator can read the refill clock.'; end if;

  v_next := date_trunc('day', now()) + interval '1 day' + interval '5 minutes';

  select max(credits_reset_at) into v_last from public.indra_users;
  select schedule into v_job from cron.job where jobname = 'indra-credit-daily-reset' limit 1;

  return jsonb_build_object(
    'nextResetAt', v_next,
    'lastRefillAt', v_last,
    'schedule', v_job,
    'totalAccounts', (select count(*) from public.indra_users),
    'suspendedAccounts', (select count(*) from public.indra_users where suspended_at is not null)
  );
end $$;

revoke all on function public.indra_credit_reset_info() from public, anon;
grant execute on function public.indra_credit_reset_info() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Claiming the role — once, deliberately, and never from somebody using it
-- ---------------------------------------------------------------------------
-- The app never calls this on page load. It is a button, pressed by an
-- administrator who has been told the server does not yet recognise them.
--
-- The rule, stated positively: refuse if a *different* account holds the role
-- and is still using it. An account that has never signed in, or one that has
-- been suspended, is not using it, so a project whose role was seeded by an
-- abandoned profile has a way back. Nobody can use this to take a working
-- administrator's role away.

create or replace function public.indra_claim_credit_admin()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me     text := public.indra_uid();
  v_holder text;
  v_role   text;
begin
  if v_me is null then
    raise exception 'Claiming the credit console needs a signed-in cloud identity.';
  end if;

  select u.id into v_holder
    from public.indra_users u
   where u.role = 'admin'
     and u.id <> v_me
     and u.last_sign_in_at is not null
     and u.suspended_at is null
   limit 1;

  if v_holder is not null then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'Another account already administers credits. It has to hand the role over.'
    );
  end if;

  -- Only now, and only ever one: the caller becomes it, everybody else is not.
  update public.indra_users set role = 'member' where role = 'admin' and id <> v_me;
  update public.indra_users set role = 'admin' where id = v_me and role <> 'admin';

  -- Read the row that was just written. `indra_is_admin()` is stable, and
  -- inside this statement it can still answer from the earlier snapshot.
  select u.role into v_role from public.indra_users u where u.id = v_me;
  if v_role = 'admin' then
    return jsonb_build_object('claimed', true, 'reason', null, 'userId', v_me);
  end if;

  return jsonb_build_object('claimed', false, 'reason', 'The server did not keep the role. Try again.');
end $$;

revoke all on function public.indra_claim_credit_admin() from public, anon;
grant execute on function public.indra_claim_credit_admin() to authenticated;
