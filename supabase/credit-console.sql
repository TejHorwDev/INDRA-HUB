-- ---------------------------------------------------------------------------
-- INDRA HUB — the credit console
--
-- Run after ai-credits.sql.
--
-- What changes, and why
-- ---------------------
-- The first cut of the credit system had a rupee price baked into three rows:
-- `price_inr` on the plan, and `ceil(credits / 100) * 99` written into the
-- purchase function. That is a deployment, not a setting. Credits are meant to
-- pay for more than the AI writer, so the price of everything has to be a
-- value an administrator edits from the console and the server enforces:
--
--   indra_credit_settings   one row: currency, what a credit buys, the top-up
--                           pack and its price, the floor and ceiling of a
--                           top-up, and when to warn somebody they are low.
--   indra_plans.price_minor  what a tier costs, in the minor unit of the
--                           workspace currency (cents, paisa, fils, …).
--   indra_plans.enabled      a tier can be retired without deleting the
--                           accounts that are on it.
--
-- Prices are stored in minor units so nothing rounds in the app: 399 is
-- $3.99, and the server is the only thing that turns a request into a price.
-- A request records the amount and the currency it was quoted in, because a
-- workspace that changes currency must not silently rewrite old receipts.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Plans gain a currency-neutral price and a switch
-- ---------------------------------------------------------------------------

alter table public.indra_plans add column if not exists price_minor bigint not null default 0;
alter table public.indra_plans add column if not exists enabled boolean not null default true;

-- The three tiers that shipped priced in whole rupees become dollar prices
-- once, at the default of the new currency. An administrator who has already
-- set a minor price is left alone.
update public.indra_plans set price_minor = 0   where id = 'free'  and price_minor = 0 and price_inr = 0;
update public.indra_plans set price_minor = 399 where id = 'basic' and price_minor = 0 and price_inr = 299;
update public.indra_plans set price_minor = 999 where id = 'pro'   and price_minor = 0 and price_inr = 899;

-- ---------------------------------------------------------------------------
-- 2. One row of settings
-- ---------------------------------------------------------------------------

create table if not exists public.indra_credit_settings (
  id                text primary key default 'default' check (id = 'default'),
  currency          text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  currency_symbol   text not null default '$' check (length(currency_symbol) between 1 and 6),
  currency_decimals integer not null default 2 check (currency_decimals between 0 and 3),
  -- There is no exchange rate. A charge is the token count the provider
  -- reported, so a "tokens per credit" column has nothing to describe.
  -- The top-up unit: `topup_tokens` credits for `topup_price_minor` minor
  -- units. Larger top-ups are priced in whole packs of this size.
  topup_tokens     integer not null default 100000 check (topup_tokens between 1 and 100000000),
  topup_price_minor bigint  not null default 10000 check (topup_price_minor >= 0),
  min_topup_credits integer not null default 100000 check (min_topup_credits >= 1),
  max_topup_credits integer not null default 100000000 check (max_topup_credits >= 1),
  -- The balance at which the app starts suggesting a top-up: below one reply.
  low_balance       integer not null default 3000 check (low_balance >= 0),
  updated_at        timestamptz not null default now(),
  updated_by        text,
  check (min_topup_credits <= max_topup_credits)
);

insert into public.indra_credit_settings (id) values ('default')
on conflict (id) do nothing;

alter table public.indra_credit_settings enable row level security;

drop policy if exists indra_credit_settings_select on public.indra_credit_settings;
create policy indra_credit_settings_select on public.indra_credit_settings
  for select to authenticated using (true);

-- Readable, never writable by a client. The function below is the only way in.
revoke insert, update, delete on public.indra_credit_settings from authenticated, anon;
grant select on public.indra_credit_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The shape the app reads
-- ---------------------------------------------------------------------------

create or replace function public.indra_credit_settings_public()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'currency', s.currency,
    'symbol', s.currency_symbol,
    'decimals', s.currency_decimals,
    'topupTokens', s.topup_tokens,
    'topupPriceMinor', s.topup_price_minor,
    'minTopup', s.min_topup_credits,
    'maxTopup', s.max_topup_credits,
    'lowBalance', s.low_balance,
    'updatedAt', s.updated_at
  )
    from public.indra_credit_settings s
   where s.id = 'default'
$$;

revoke all on function public.indra_credit_settings_public() from public, anon;
grant execute on function public.indra_credit_settings_public() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Receipts remember the currency they were quoted in
-- ---------------------------------------------------------------------------

alter table public.indra_purchase_requests add column if not exists amount_minor bigint;
alter table public.indra_purchase_requests add column if not exists currency text;

-- Everything that exists was priced in whole rupees, so that is what it says.
update public.indra_purchase_requests
   set amount_minor = coalesce(amount_minor, amount_inr::bigint),
       currency = coalesce(currency, 'INR')
 where amount_minor is null or currency is null;

-- ---------------------------------------------------------------------------
-- 5. The state the screen draws, now with the rules attached
-- ---------------------------------------------------------------------------

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
    'isAdmin', public.indra_is_admin(),
    'settings', public.indra_credit_settings_public()
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Asking for more, priced by the server
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
  v_me    text := public.indra_uid();
  v_cfg   public.indra_credit_settings;
  v_plan  public.indra_plans;
  v_price bigint := 0;
  v_id    text;
begin
  if v_me is null then
    raise exception 'Sign in to the cloud first.';
  end if;
  if p_kind not in ('plan', 'credits') then
    raise exception 'Unknown request type.';
  end if;

  select * into v_cfg from public.indra_credit_settings where id = 'default';
  if v_cfg is null then
    raise exception 'The credit settings are missing.';
  end if;

  if p_kind = 'plan' then
    select * into v_plan from public.indra_plans where id = p_plan;
    if v_plan is null then
      raise exception 'That plan does not exist.';
    end if;
    if not v_plan.enabled then
      raise exception 'That plan is no longer offered.';
    end if;
    if exists (select 1 from public.indra_users where id = v_me and plan = p_plan) then
      raise exception 'This account is already on that plan.';
    end if;
    v_price := v_plan.price_minor;
  else
    if p_credits is null
       or p_credits < v_cfg.min_topup_credits
       or p_credits > v_cfg.max_topup_credits then
      raise exception 'Choose between % and % credits.',
        v_cfg.min_topup_credits, v_cfg.max_topup_credits;
    end if;
    -- Whole packs: 250 credits at 100 credits per pack is three packs.
    v_price := ceil(p_credits::numeric / greatest(v_cfg.topup_tokens, 1))::bigint
               * v_cfg.topup_price_minor;
  end if;

  if exists (
    select 1 from public.indra_purchase_requests
     where user_id = v_me and status = 'pending' and kind = p_kind
       and coalesce(plan_id, '') = coalesce(p_plan, '')
  ) then
    raise exception 'That request is already waiting for an answer.';
  end if;

  insert into public.indra_purchase_requests
    (user_id, kind, plan_id, credits, amount_minor, currency, note)
  values
    (v_me, p_kind,
     case when p_kind = 'plan' then p_plan end,
     case when p_kind = 'credits' then p_credits end,
     v_price, v_cfg.currency,
     left(coalesce(p_note, ''), 400))
  returning id into v_id;

  return v_id;
end
$$;

create or replace function public.indra_my_purchases()
returns table (id text, kind text, plan_id text, plan_name text, credits bigint,
               amount_minor bigint, currency text, status text, note text,
               created_at timestamptz, decided_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id, r.kind, r.plan_id, p.name, r.credits,
         r.amount_minor, r.currency, r.status, r.note, r.created_at, r.decided_at
    from public.indra_purchase_requests r
    left join public.indra_plans p on p.id = r.plan_id
   where r.user_id = public.indra_uid()
   order by r.created_at desc
   limit 40
$$;

-- ---------------------------------------------------------------------------
-- 7. Administration
-- ---------------------------------------------------------------------------

create or replace function public.indra_admin_purchases(p_status text default 'pending')
returns table (id text, user_id text, user_name text, user_email text, kind text,
               plan_id text, plan_name text, credits bigint, amount_minor bigint,
               currency text, status text, note text, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id, r.user_id, u.display_name, u.contact_email, r.kind, r.plan_id,
         p.name, r.credits, r.amount_minor, r.currency, r.status, r.note, r.created_at
    from public.indra_purchase_requests r
    join public.indra_users u on u.id = r.user_id
    left join public.indra_plans p on p.id = r.plan_id
   where public.indra_is_admin()
     and (p_status is null or r.status = p_status)
   order by r.created_at asc
   limit 200
$$;

-- The approval path records the currency the person was quoted, not today's.
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
  v_req     public.indra_purchase_requests;
  v_plan    public.indra_plans;
  v_balance bigint;
  v_me      text := public.indra_uid();
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

    update public.indra_users
       set plan = v_plan.id,
           plan_expires_at = now() + interval '30 days',
           daily_tokens = v_plan.daily_tokens,
           credits_reset_at = date_trunc('day', now()) + interval '1 day'
     where id = v_req.user_id
     returning daily_tokens + purchased_tokens into v_balance;

    insert into public.indra_credit_ledger (user_id, kind, amount, balance_after, meta)
    values (v_req.user_id, 'grant', v_plan.daily_tokens, v_balance,
            jsonb_build_object('plan', v_plan.id, 'request', v_req.id,
                               'minor', v_req.amount_minor, 'currency', v_req.currency));
  else
    update public.indra_users
       set purchased_tokens = purchased_tokens + coalesce(v_req.credits, 0)
     where id = v_req.user_id
     returning daily_tokens + purchased_tokens into v_balance;

    insert into public.indra_credit_ledger (user_id, kind, amount, balance_after, meta)
    values (v_req.user_id, 'purchase', coalesce(v_req.credits, 0), v_balance,
            jsonb_build_object('request', v_req.id, 'minor', v_req.amount_minor,
                               'currency', v_req.currency));
  end if;

  update public.indra_purchase_requests
     set status = 'approved', decided_by = v_me, decided_at = now(),
         note = left(coalesce(nullif(trim(p_note), ''), note), 400)
   where id = p_id;

  return jsonb_build_object('status', 'approved', 'balance', v_balance);
end
$$;

/*
 * Writing a tier, including a new one.
 *
 * `p_create` says whether a missing id is an error or an insertion. A plan
 * that accounts are sitting on cannot be switched off by accident: the count
 * is checked first and the refusal names the number, so the console can say
 * something true instead of showing a generic failure.
 */
create or replace function public.indra_admin_save_plan(
  p_id text,
  p_name text default null,
  p_blurb text default null,
  p_daily integer default null,
  p_price_minor bigint default null,
  p_sort integer default null,
  p_enabled boolean default null,
  p_create boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    text := lower(trim(coalesce(p_id, '')));
  v_plan  public.indra_plans;
  v_used  integer;
begin
  if not public.indra_is_admin() then raise exception 'Only an administrator can change a plan.'; end if;
  if v_id !~ '^[a-z0-9][a-z0-9_-]{1,30}$' then
    raise exception 'A plan id is 2–31 lowercase letters, digits, dashes or underscores.';
  end if;
  if p_daily is not null and (p_daily < 0 or p_daily > 1000000) then
    raise exception 'A daily allowance must be between 0 and 1,000,000 credits.';
  end if;
  if p_price_minor is not null and (p_price_minor < 0 or p_price_minor > 100000000) then
    raise exception 'A price must be between 0 and 1,000,000 in the workspace currency.';
  end if;

  select * into v_plan from public.indra_plans where id = v_id;

  if v_plan is null then
    if not p_create then
      raise exception 'That plan does not exist.';
    end if;
    if nullif(trim(coalesce(p_name, '')), '') is null then
      raise exception 'Give the new tier a name.';
    end if;
    insert into public.indra_plans (id, name, blurb, daily_tokens, price_minor, sort, enabled)
    values (v_id, trim(p_name), coalesce(p_blurb, ''), coalesce(p_daily, 0),
            coalesce(p_price_minor, 0), coalesce(p_sort, 99), coalesce(p_enabled, true))
    returning * into v_plan;
    return jsonb_build_object('id', v_plan.id, 'created', true);
  end if;

  if p_enabled is false then
    select count(*) into v_used from public.indra_users where plan = v_id;
    if v_used > 0 then
      raise exception 'That tier cannot be switched off while % account(s) are on it.', v_used;
    end if;
  end if;

  update public.indra_plans
     set name = coalesce(nullif(trim(p_name), ''), name),
         blurb = coalesce(p_blurb, blurb),
         daily_tokens = coalesce(p_daily, daily_tokens),
         price_minor = coalesce(p_price_minor, price_minor),
         sort = coalesce(p_sort, sort),
         enabled = coalesce(p_enabled, enabled)
   where id = v_id
   returning * into v_plan;

  return jsonb_build_object('id', v_plan.id, 'created', false);
end
$$;

/*
 * The pricing rules. Every field is optional so the console can save one
 * thing without restating the rest; the row is written once, whole.
 */
create or replace function public.indra_admin_update_credit_settings(
  p_currency text default null,
  p_symbol text default null,
  p_decimals integer default null,
  p_topup_tokens integer default null,
  p_topup_price_minor bigint default null,
  p_min_topup integer default null,
  p_max_topup integer default null,
  p_low_balance integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_row  public.indra_credit_settings;
begin
  if not public.indra_is_admin() then
    raise exception 'Only an administrator can change the pricing settings.';
  end if;

  v_code := upper(trim(coalesce(p_currency, '')));
  if v_code <> '' and v_code !~ '^[A-Z]{3}$' then
    raise exception 'A currency is a three-letter code, like USD or NPR.';
  end if;
  if p_symbol is not null and (length(trim(p_symbol)) < 1 or length(trim(p_symbol)) > 6) then
    raise exception 'A symbol is 1–6 characters.';
  end if;
  if p_decimals is not null and (p_decimals < 0 or p_decimals > 3) then
    raise exception 'Decimals run from 0 to 3.';
  end if;
  if p_topup_tokens is not null and (p_topup_tokens < 1 or p_topup_tokens > 100000000) then
    raise exception 'A pack is at least one token.';
  end if;
  if p_topup_price_minor is not null and (p_topup_price_minor < 0 or p_topup_price_minor > 100000000) then
    raise exception 'A pack price must be between 0 and 1,000,000.';
  end if;
  if p_low_balance is not null and (p_low_balance < 0 or p_low_balance > 100000000) then
    raise exception 'The low-balance mark must be a sensible token count.';
  end if;

  update public.indra_credit_settings
     set currency = coalesce(nullif(v_code, ''), currency),
         currency_symbol = coalesce(nullif(trim(p_symbol), ''), currency_symbol),
         currency_decimals = coalesce(p_decimals, currency_decimals),
         topup_tokens = coalesce(p_topup_tokens, topup_tokens),
         topup_price_minor = coalesce(p_topup_price_minor, topup_price_minor),
         min_topup_credits = coalesce(p_min_topup, min_topup_credits),
         max_topup_credits = coalesce(p_max_topup, max_topup_credits),
         low_balance = coalesce(p_low_balance, low_balance),
         updated_at = now(),
         updated_by = public.indra_uid()
   where id = 'default'
   returning * into v_row;

  if v_row.min_topup_credits > v_row.max_topup_credits then
    raise exception 'The smallest top-up cannot be larger than the largest.';
  end if;

  return public.indra_credit_settings_public();
end
$$;

-- ---------------------------------------------------------------------------
-- 8. Execution rights
-- ---------------------------------------------------------------------------

revoke all on function public.indra_request_purchase(text, text, bigint, text) from public, anon;
revoke all on function public.indra_my_purchases() from public, anon;
revoke all on function public.indra_admin_purchases(text) from public, anon;
revoke all on function public.indra_admin_decide_purchase(text, boolean, text) from public, anon;
revoke all on function public.indra_admin_save_plan(text, text, text, integer, bigint, integer, boolean, boolean) from public, anon;
revoke all on function public.indra_admin_update_credit_settings(text, text, integer, integer, integer, bigint, integer, integer, integer) from public, anon;

grant execute on function public.indra_request_purchase(text, text, bigint, text) to authenticated;
grant execute on function public.indra_my_purchases() to authenticated;
grant execute on function public.indra_admin_purchases(text) to authenticated;
grant execute on function public.indra_admin_decide_purchase(text, boolean, text) to authenticated;
grant execute on function public.indra_admin_save_plan(text, text, text, integer, bigint, integer, boolean, boolean) to authenticated;
grant execute on function public.indra_admin_update_credit_settings(text, text, integer, integer, integer, bigint, integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The 2.0.1 console's entry point, kept working
--
-- A shipped build still calls indra_admin_update_plan() with a rupee price.
-- Rather than break it, that function now writes the currency-neutral price it
-- is given, and a rupee figure is only accepted while the workspace currency is
-- still INR. New builds use indra_admin_save_plan().
-- ---------------------------------------------------------------------------

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
declare
  v_cfg public.indra_credit_settings;
begin
  select * into v_cfg from public.indra_credit_settings where id = 'default';
  if p_price is not null and coalesce(v_cfg.currency, 'INR') <> 'INR' then
    raise exception 'This workspace prices in %. Update the app to set a price.', v_cfg.currency;
  end if;
  perform public.indra_admin_save_plan(
    p_id, p_name, p_blurb, p_daily, p_price::bigint, null, null, false
  );
  return public.indra_credit_settings_public();
end
$$;

revoke all on function public.indra_admin_update_plan(text, text, integer, integer, text) from public, anon;
grant execute on function public.indra_admin_update_plan(text, text, integer, integer, text) to authenticated;
