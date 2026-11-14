-- ---------------------------------------------------------------------------
-- INDRA HUB — AI plans, credits and purchases (server-enforced)
--
-- THIS FILE IS SUPERSEDED for anything that prices a top-up: run
-- credit-console.sql after it, which replaces the plan table's price column
-- with a currency-neutral one, adds the pricing settings, and rewrites the
-- functions that quote a price. What remains true here is the part this file
-- was written for: the balance is Postgres's, the ledger is append-only, and
-- only the service role may move a balance.
--
-- Run after schema.sql, auth.sql and sharing.sql.
--
-- The rule this file exists to enforce
-- ------------------------------------
-- Every account owns its own SQLite file, so a balance kept on the user's
-- machine is a number the user can edit. Nothing here trusts one: the balance
-- lives in Postgres, the ledger is append-only, and the only function that may
-- move a balance is revoked from `authenticated` and granted to `service_role`
-- alone — the Edge Function's key. The app can read its own state and ask for a
-- purchase; it cannot pay itself.
--
-- The unit is tokens. A charge is the token count the provider reported; there
-- is no exchange rate. (This file predates that rule and still divides by a
-- pack size when it quotes a price; credit-console.sql, which must be run after
-- it, replaces that with the administrator's own settings.)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Plans
-- ---------------------------------------------------------------------------

create table if not exists public.indra_plans (
  id            text primary key,
  name          text not null,
  blurb         text not null default '',
  daily_tokens integer not null check (daily_tokens >= 0),
  price_inr     integer not null default 0,
  sort          integer not null default 0
);

insert into public.indra_plans (id, name, blurb, daily_tokens, price_inr, sort) values
  ('free',  'Free',  'For trying the writing tools and a little research.',        100,    0, 1),
  ('basic', 'Basic', 'For a student writing every day.',                           600,  299, 2),
  ('pro',   'Pro',   'For long research and a lot of documents.',                 2500,  899, 3)
on conflict (id) do update
  set name = excluded.name,
      blurb = excluded.blurb,
      daily_tokens = excluded.daily_tokens,
      price_inr = excluded.price_inr,
      sort = excluded.sort;

alter table public.indra_plans enable row level security;
drop policy if exists indra_plans_select on public.indra_plans;
create policy indra_plans_select on public.indra_plans
  for select to authenticated using (true);
grant select on public.indra_plans to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The balance
--
-- Two buckets, because they answer different questions: the daily allowance
-- belongs to the plan and is refilled, the purchased balance was paid for and
-- never expires.
-- ---------------------------------------------------------------------------

alter table public.indra_users add column if not exists plan text not null default 'free';
alter table public.indra_users add column if not exists plan_expires_at timestamptz;
alter table public.indra_users add column if not exists daily_tokens bigint not null default 0;
alter table public.indra_users add column if not exists purchased_tokens bigint not null default 0;
alter table public.indra_users add column if not exists credits_reset_at timestamptz
  not null default (date_trunc('day', now()) + interval '1 day');
alter table public.indra_users add column if not exists ai_requests integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'indra_users_plan_fkey'
  ) then
    alter table public.indra_users
      add constraint indra_users_plan_fkey foreign key (plan) references public.indra_plans(id);
  end if;
end
$$;

-- Existing accounts start at the free allowance for today.
update public.indra_users u
   set daily_tokens = p.daily_tokens
  from public.indra_plans p
 where u.plan = p.id and u.daily_tokens = 0 and u.ai_requests = 0;

-- ---------------------------------------------------------------------------
-- 3. The ledger — append-only, one row per movement
-- ---------------------------------------------------------------------------

create table if not exists public.indra_credit_ledger (
  id            text primary key default gen_random_uuid()::text,
  user_id       text not null references public.indra_users(id) on delete cascade,
  kind          text not null check (kind in ('usage', 'purchase', 'grant', 'reset', 'adjust')),
  amount        bigint not null,
  balance_after bigint not null,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists indra_ledger_user_idx
  on public.indra_credit_ledger (user_id, created_at desc);
create index if not exists indra_ledger_day_idx
  on public.indra_credit_ledger (user_id, created_at) where kind = 'usage';

alter table public.indra_credit_ledger enable row level security;

drop policy if exists indra_ledger_select_own on public.indra_credit_ledger;
create policy indra_ledger_select_own on public.indra_credit_ledger
  for select to authenticated using (user_id = public.indra_uid());

-- No insert/update/delete for anyone but the functions below (definer).
revoke insert, update, delete on public.indra_credit_ledger from authenticated, anon;
grant select on public.indra_credit_ledger to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Purchase requests
-- ---------------------------------------------------------------------------

create table if not exists public.indra_purchase_requests (
  id          text primary key default gen_random_uuid()::text,
  user_id     text not null references public.indra_users(id) on delete cascade,
  kind        text not null check (kind in ('plan', 'credits')),
  plan_id     text references public.indra_plans(id),
  credits     bigint,
  amount_inr  integer not null default 0,
  note        text not null default '',
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by  text references public.indra_users(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  check (
    (kind = 'plan' and plan_id is not null) or
    (kind = 'credits' and credits is not null and credits > 0)
  )
);

create unique index if not exists indra_purchases_pending_idx
  on public.indra_purchase_requests (user_id, kind, coalesce(plan_id, ''))
  where status = 'pending';

create index if not exists indra_purchases_status_idx
  on public.indra_purchase_requests (status, created_at desc);

alter table public.indra_purchase_requests enable row level security;

drop policy if exists indra_purchases_select_own on public.indra_purchase_requests;
create policy indra_purchases_select_own on public.indra_purchase_requests
  for select to authenticated using (user_id = public.indra_uid());

-- Requests are opened and decided only through the functions below.
revoke insert, update, delete on public.indra_purchase_requests from authenticated, anon;
grant select on public.indra_purchase_requests to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The day
-- ---------------------------------------------------------------------------

/**
 * Refills the daily bucket if the last refill is in the past.
 *
 * Laziness is deliberate: a cron job can be late, paused or missing, but the
 * first request of the day must still see today's allowance. Both this function
 * and the scheduled job are safe to run in any order.
 */
create or replace function public.indra_ensure_credit_day(p_user text)
returns public.indra_users
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  public.indra_users;
  v_allow integer;
  v_total bigint;
begin
  select * into v_user from public.indra_users where id = p_user for update;
  if not found then
    return null;
  end if;

  if v_user.credits_reset_at is null or v_user.credits_reset_at <= now() then
    select daily_tokens into v_allow from public.indra_plans where id = v_user.plan;
    v_total := coalesce(v_allow, 0) + v_user.purchased_tokens;

    update public.indra_users
       set daily_tokens = coalesce(v_allow, 0),
           credits_reset_at = date_trunc('day', now()) + interval '1 day'
     where id = v_user.id;

    insert into public.indra_credit_ledger (user_id, kind, amount, balance_after, meta)
    values (v_user.id, 'reset', coalesce(v_allow, 0), v_total,
            jsonb_build_object('plan', v_user.plan, 'at', date_trunc('day', now())));

    v_user.daily_tokens := coalesce(v_allow, 0);
    v_user.credits_reset_at := date_trunc('day', now()) + interval '1 day';
  end if;

  return v_user;
end
$$;

/** What the app shows: plan, both buckets, the next refill, today's spend. */
create or replace function public.indra_credit_state()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me   text := public.indra_uid();
  v_user public.indra_users;
  v_plan public.indra_plans;
  v_spent bigint;
begin
  if v_me is null then
    raise exception 'Sign in to the cloud first.';
  end if;

  v_user := public.indra_ensure_credit_day(v_me);
  if v_user is null then
    raise exception 'This account has no cloud profile yet.';
  end if;

  select * into v_plan from public.indra_plans where id = v_user.plan;

  select coalesce(-sum(amount), 0) into v_spent
    from public.indra_credit_ledger
   where user_id = v_me and kind = 'usage' and created_at >= date_trunc('day', now());

  return jsonb_build_object(
    'plan', v_user.plan,
    'planName', coalesce(v_plan.name, v_user.plan),
    'dailyAllowance', coalesce(v_plan.daily_tokens, 0),
    'daily', v_user.daily_tokens,
    'purchased', v_user.purchased_tokens,
    'total', v_user.daily_tokens + v_user.purchased_tokens,
    'spentToday', v_spent,
    'requestsToday', v_user.ai_requests,
    'resetAt', v_user.credits_reset_at,
    'planExpiresAt', v_user.plan_expires_at,
    'isAdmin', public.indra_is_admin()
  );
end
$$;

/**
 * The only way a balance goes down.
 *
 * Revoked from `authenticated` on purpose: a client that could call this could
 * pass a negative cost and pay itself. The Edge Function calls it with the
 * service-role key, after the provider has answered and the real token count is
 * known.
 */
create or replace function public.indra_spend_ai(p_user text, p_cost bigint, p_meta jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  public.indra_users;
  v_daily bigint;
  v_bought bigint;
begin
  if p_cost is null or p_cost < 0 then
    raise exception 'A charge cannot be negative.';
  end if;

  v_user := public.indra_ensure_credit_day(p_user);
  if v_user is null then
    raise exception 'This account has no cloud profile.';
  end if;

  if v_user.daily_tokens + v_user.purchased_tokens < p_cost then
    raise exception 'insufficient_credits'
      using detail = format('Balance %s, cost %s.', v_user.daily_tokens + v_user.purchased_tokens, p_cost);
  end if;

  v_daily := least(v_user.daily_tokens, p_cost);
  v_bought := p_cost - v_daily;

  update public.indra_users
     set daily_tokens = daily_tokens - v_daily,
         purchased_tokens = purchased_tokens - v_bought,
         ai_requests = ai_requests + 1
   where id = p_user;

  insert into public.indra_credit_ledger (user_id, kind, amount, balance_after, meta)
  values (p_user, 'usage', -p_cost,
          v_user.daily_tokens + v_user.purchased_tokens - p_cost, p_meta);

  return jsonb_build_object(
    'daily', v_user.daily_tokens - v_daily,
    'purchased', v_user.purchased_tokens - v_bought,
    'total', v_user.daily_tokens + v_user.purchased_tokens - p_cost,
    'cost', p_cost
  );
end
$$;

/** The scheduled job's entry point. Service role only. */
create or replace function public.indra_reset_all_daily()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select id from public.indra_users where credits_reset_at <= now()
  loop
    perform public.indra_ensure_credit_day(v_row.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Asking for more
-- ---------------------------------------------------------------------------

create or replace function public.indra_request_purchase(
  p_kind text,
  p_plan text default null,
  p_credits bigint default null,
  p_note text default ''
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me   text := public.indra_uid();
  v_price integer := 0;
  v_id   text;
begin
  if v_me is null then
    raise exception 'Sign in to the cloud first.';
  end if;
  if p_kind not in ('plan', 'credits') then
    raise exception 'Unknown request type.';
  end if;

  if p_kind = 'plan' then
    select price_inr into v_price from public.indra_plans where id = p_plan;
    if v_price is null then
      raise exception 'That plan does not exist.';
    end if;
    if exists (select 1 from public.indra_users where id = v_me and plan = p_plan) then
      raise exception 'This account is already on that plan.';
    end if;
  else
    if p_credits is null or p_credits < 100 or p_credits > 100000 then
      raise exception 'Choose between 100 and 100,000 tokens.';
    end if;
    -- One pack of 100 buys one charge of ₹99; the price rises with the pack.
    -- credit-console.sql replaces this with the administrator's own numbers.
    v_price := ceil(p_credits / 100.0)::integer * 99;
  end if;

  if exists (
    select 1 from public.indra_purchase_requests
     where user_id = v_me and status = 'pending' and kind = p_kind
       and coalesce(plan_id, '') = coalesce(p_plan, '')
  ) then
    raise exception 'That request is already waiting for an answer.';
  end if;

  insert into public.indra_purchase_requests (user_id, kind, plan_id, credits, amount_inr, note)
  values (v_me, p_kind,
          case when p_kind = 'plan' then p_plan end,
          case when p_kind = 'credits' then p_credits end,
          v_price, left(coalesce(p_note, ''), 400))
  returning id into v_id;

  return v_id;
end
$$;

create or replace function public.indra_my_ledger(p_limit integer default 40)
returns table (id text, kind text, amount bigint, balance_after bigint, meta jsonb, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.id, l.kind, l.amount, l.balance_after, l.meta, l.created_at
    from public.indra_credit_ledger l
   where l.user_id = public.indra_uid()
   order by l.created_at desc
   limit least(greatest(coalesce(p_limit, 40), 1), 200)
$$;

create or replace function public.indra_my_purchases()
returns table (id text, kind text, plan_id text, credits bigint, amount_inr integer,
               status text, note text, created_at timestamptz, decided_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id, r.kind, r.plan_id, r.credits, r.amount_inr, r.status, r.note, r.created_at, r.decided_at
    from public.indra_purchase_requests r
   where r.user_id = public.indra_uid()
   order by r.created_at desc
   limit 40
$$;

create or replace function public.indra_cancel_purchase(p_id text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me text := public.indra_uid();
begin
  update public.indra_purchase_requests
     set status = 'rejected', decided_at = now(), decided_by = null, note = left(note || ' (withdrawn)', 400)
   where id = p_id and user_id = v_me and status = 'pending';
  return found;
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Administration
-- ---------------------------------------------------------------------------

create or replace function public.indra_admin_purchases(p_status text default 'pending')
returns table (id text, user_id text, user_name text, user_email text, kind text,
               plan_id text, credits bigint, amount_inr integer, status text,
               note text, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id, r.user_id, u.display_name, u.contact_email, r.kind, r.plan_id, r.credits,
         r.amount_inr, r.status, r.note, r.created_at
    from public.indra_purchase_requests r
    join public.indra_users u on u.id = r.user_id
   where public.indra_is_admin()
     and (p_status is null or r.status = p_status)
   order by r.created_at asc
   limit 200
$$;

/**
 * Approve or reject. Approval is the only place a plan or purchased credits
 * change without money moving through the provider, and it is admin-only,
 * audited, and logged in the same ledger the usage is.
 */
create or replace function public.indra_admin_decide_purchase(
  p_id text,
  p_approve boolean,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req  public.indra_purchase_requests;
  v_allow integer;
  v_plan public.indra_plans;
  v_balance bigint;
  v_me   text := public.indra_uid();
begin
  if not public.indra_is_admin() then
    raise exception 'Only an administrator can answer a purchase request.';
  end if;

  select * into v_req from public.indra_purchase_requests where id = p_id for update;
  if not found then
    raise exception 'That request no longer exists.';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'That request has already been answered.';
  end if;

  if not p_approve then
    update public.indra_purchase_requests
       set status = 'rejected', decided_by = v_me, decided_at = now(),
           note = left(coalesce(nullif(trim(p_note), ''), note), 400)
     where id = p_id;
    return jsonb_build_object('status', 'rejected');
  end if;

  if v_req.kind = 'plan' then
    select * into v_plan from public.indra_plans where id = v_req.plan_id;
    if v_plan is null then
      raise exception 'That plan no longer exists.';
    end if;

    select ai_requests + 1, daily_tokens into v_allow, v_balance
      from public.indra_users where id = v_req.user_id;

    update public.indra_users
       set plan = coalesce(v_req.plan_id, plan),
           plan_expires_at = now() + interval '30 days',
           daily_tokens = v_plan.daily_tokens,
           credits_reset_at = date_trunc('day', now()) + interval '1 day'
     where id = v_req.user_id
     returning daily_tokens + purchased_tokens into v_balance;

    insert into public.indra_credit_ledger (user_id, kind, amount, balance_after, meta)
    values (v_req.user_id, 'grant', v_plan.daily_tokens, v_balance,
            jsonb_build_object('plan', v_plan.id, 'request', v_req.id));
  else
    update public.indra_users
       set purchased_tokens = purchased_tokens + coalesce(v_req.credits, 0)
     where id = v_req.user_id
     returning daily_tokens + purchased_tokens into v_balance;

    insert into public.indra_credit_ledger (user_id, kind, amount, balance_after, meta)
    values (v_req.user_id, 'purchase', coalesce(v_req.credits, 0), v_balance,
            jsonb_build_object('request', v_req.id, 'inr', v_req.amount_inr));
  end if;

  update public.indra_purchase_requests
     set status = 'approved', decided_by = v_me, decided_at = now(),
         note = left(coalesce(nullif(trim(p_note), ''), note), 400)
   where id = p_id;

  return jsonb_build_object('status', 'approved', 'balance', v_balance);
end
$$;

create or replace function public.indra_admin_set_plan(p_user text, p_plan text, p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.indra_plans;
  v_balance bigint;
begin
  if not public.indra_is_admin() then
    raise exception 'Only an administrator can change a plan.';
  end if;
  select * into v_plan from public.indra_plans where id = p_plan;
  if v_plan is null then
    raise exception 'That plan does not exist.';
  end if;

  update public.indra_users
     set plan = p_plan,
         plan_expires_at = now() + make_interval(days => greatest(coalesce(p_days, 30), 1)),
         daily_tokens = v_plan.daily_tokens,
         credits_reset_at = date_trunc('day', now()) + interval '1 day'
   where id = p_user
   returning daily_tokens + purchased_tokens into v_balance;

  if not found then
    raise exception 'That account does not exist.';
  end if;

  insert into public.indra_credit_ledger (user_id, kind, amount, balance_after, meta)
  values (p_user, 'grant', v_plan.daily_tokens, v_balance,
          jsonb_build_object('plan', p_plan, 'by', 'admin'));

  return jsonb_build_object('plan', p_plan, 'balance', v_balance);
end
$$;

create or replace function public.indra_admin_grant_credits(p_user text, p_amount bigint, p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance bigint;
begin
  if not public.indra_is_admin() then
    raise exception 'Only an administrator can grant credits.';
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 then
    raise exception 'Give an amount between -1,000,000 and 1,000,000.';
  end if;

  update public.indra_users
     set purchased_tokens = greatest(0, purchased_tokens + p_amount)
   where id = p_user
   returning daily_tokens + purchased_tokens into v_balance;

  if not found then
    raise exception 'That account does not exist.';
  end if;

  insert into public.indra_credit_ledger (user_id, kind, amount, balance_after, meta)
  values (p_user, 'adjust', p_amount, v_balance, jsonb_build_object('reason', left(coalesce(p_reason, ''), 200)));

  return jsonb_build_object('balance', v_balance);
end
$$;

-- ---------------------------------------------------------------------------
-- 8. Execution rights
--
-- The important line in this file: `indra_spend_ai` is NOT granted to
-- `authenticated`. A signed-in client cannot charge any account, including its
-- own, and the Edge Function is the only caller.
-- ---------------------------------------------------------------------------

revoke all on function public.indra_ensure_credit_day(text) from public, anon, authenticated;
revoke all on function public.indra_spend_ai(text, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.indra_reset_all_daily() from public, anon, authenticated;
grant execute on function public.indra_ensure_credit_day(text) to service_role;
grant execute on function public.indra_spend_ai(text, bigint, jsonb) to service_role;
grant execute on function public.indra_reset_all_daily() to service_role;

revoke all on function public.indra_credit_state() from public, anon;
revoke all on function public.indra_request_purchase(text, text, bigint, text) from public, anon;
revoke all on function public.indra_my_ledger(integer) from public, anon;
revoke all on function public.indra_my_purchases() from public, anon;
revoke all on function public.indra_cancel_purchase(text) from public, anon;
revoke all on function public.indra_admin_purchases(text) from public, anon;
revoke all on function public.indra_admin_decide_purchase(text, boolean, text) from public, anon;
revoke all on function public.indra_admin_set_plan(text, text, integer) from public, anon;
revoke all on function public.indra_admin_grant_credits(text, bigint, text) from public, anon;

grant execute on function public.indra_credit_state() to authenticated;
grant execute on function public.indra_request_purchase(text, text, bigint, text) to authenticated;
grant execute on function public.indra_my_ledger(integer) to authenticated;
grant execute on function public.indra_my_purchases() to authenticated;
grant execute on function public.indra_cancel_purchase(text) to authenticated;
grant execute on function public.indra_admin_purchases(text) to authenticated;
grant execute on function public.indra_admin_decide_purchase(text, boolean, text) to authenticated;
grant execute on function public.indra_admin_set_plan(text, text, integer) to authenticated;
grant execute on function public.indra_admin_grant_credits(text, bigint, text) to authenticated;

-- The balance columns are readable but never writable by a client. The grants
-- established in auth.sql and sharing.sql are the ones that stand: an account
-- may change its username, display name and contact address, and nothing else.
revoke update on public.indra_users from authenticated;
grant update (username, display_name, contact_email) on public.indra_users to authenticated;

/* ------------------------------------------------------------------ *
 * Admin reads and plan configuration
 *
 * The console needs three things it cannot get through RLS alone: a list of
 * accounts with their balances, one account's ledger, and the ability to change
 * what a tier is worth. All of it is gated inside the function bodies by
 * indra_is_admin(), so a caller who is not an administrator learns nothing and
 * changes nothing.
 * ------------------------------------------------------------------ */

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
         u.daily_tokens, u.purchased_tokens,
         u.daily_tokens + u.purchased_tokens, u.ai_requests,
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

create or replace function public.indra_admin_ledger(p_user text, p_limit integer default 50)
returns table (id text, kind text, amount bigint, balance_after bigint, meta jsonb, created_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.indra_is_admin() then raise exception 'Only an administrator can read a ledger.'; end if;
  return query
  select l.id::text, l.kind, l.amount, l.balance_after, l.meta, l.created_at
    from public.indra_credit_ledger l
   where l.user_id = p_user
   order by l.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 500);
end $$;

/* What a tier is worth is a product decision, not a deployment: the console
 * edits this row and every account on the tier is affected at its next reset. */
create or replace function public.indra_admin_update_plan(
  p_id text,
  p_name text default null,
  p_daily integer default null,
  p_price integer default null,
  p_blurb text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_plan public.indra_plans;
begin
  if not public.indra_is_admin() then raise exception 'Only an administrator can change a plan.'; end if;
  if p_daily is not null and (p_daily < 0 or p_daily > 1000000) then
    raise exception 'A daily allowance must be between 0 and 1,000,000 credits.';
  end if;
  if p_price is not null and (p_price < 0 or p_price > 1000000) then
    raise exception 'A price must be between 0 and 1,000,000 rupees.';
  end if;
  update public.indra_plans
     set name = coalesce(nullif(trim(p_name), ''), name),
         daily_tokens = coalesce(p_daily, daily_tokens),
         price_inr = coalesce(p_price, price_inr),
         blurb = coalesce(nullif(trim(p_blurb), ''), blurb)
   where id = p_id
   returning * into v_plan;
  if v_plan is null then raise exception 'That plan does not exist.'; end if;
  return jsonb_build_object('id', v_plan.id, 'name', v_plan.name,
    'daily', v_plan.daily_tokens, 'price', v_plan.price_inr, 'blurb', v_plan.blurb);
end $$;

revoke all on function public.indra_admin_accounts(text) from public, anon;
revoke all on function public.indra_admin_ledger(text, integer) from public, anon;
revoke all on function public.indra_admin_update_plan(text, text, integer, integer, text) from public, anon;
grant execute on function public.indra_admin_accounts(text) to authenticated;
grant execute on function public.indra_admin_ledger(text, integer) to authenticated;
grant execute on function public.indra_admin_update_plan(text, text, integer, integer, text) to authenticated;

/* ------------------------------------------------------------------ *
 * The daily reset, on the server's clock
 *
 * A laptop that was closed overnight must not be the thing that refills the
 * balance, and neither must the app. The schedule runs at 00:05 UTC — a few
 * minutes after the day boundary the lazy path uses — so the refill has usually
 * already happened by the time a person wakes up. indra_ensure_credit_day()
 * stays as the safety net for anything this misses.
 * ------------------------------------------------------------------ */
create extension if not exists pg_cron;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'indra-credit-daily-reset';
  if v_job is not null then perform cron.unschedule(v_job); end if;
end $$;

select cron.schedule(
  'indra-credit-daily-reset',
  '5 0 * * *',
  $job$ select public.indra_reset_all_daily(); $job$
);
