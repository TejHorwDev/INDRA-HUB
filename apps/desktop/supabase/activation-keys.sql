/*
 * Activation keys, on the server.
 *
 * They used to be a table in each PC's SQLite file. A key made on the
 * administrator's machine was therefore unknown everywhere else: another
 * install refused it as invalid, while the machine that made it happily
 * accepted a key nobody else had ever seen. That is why "key auth" and
 * registration never lined up.
 *
 * Now there is one list. Keys are generated in Postgres, stored as a SHA-256
 * digest (the plaintext is returned once, at creation, and never stored), and
 * redeemed by the server at sign-up. Every PC asks the same table.
 *
 *   indra_check_activation_key    may this code be used? (before sign-up)
 *   indra_redeem_activation_key   mark it used by the caller (after sign-up)
 *   indra_admin_keys              the list the console shows
 *   indra_admin_create_keys       make n of them, administrator only
 *   indra_admin_revoke_key        make one unusable, administrator only
 *   indra_admin_delete_key        remove the row entirely, administrator only
 */

create table if not exists public.indra_activation_keys (
  id           uuid primary key default gen_random_uuid(),
  code_hash    text not null unique,
  masked_code  text not null,
  label        text not null default '',
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  used_at      timestamptz,
  used_by      uuid references auth.users (id) on delete set null,
  used_by_email text,
  revoked_at   timestamptz,
  created_by   uuid
);

create index if not exists indra_keys_created_idx on public.indra_activation_keys (created_at desc);

alter table public.indra_activation_keys enable row level security;

drop policy if exists indra_keys_admin_read on public.indra_activation_keys;
create policy indra_keys_admin_read on public.indra_activation_keys
  for select using (public.indra_is_admin());

-- ---------------------------------------------------------------------------
-- Code generation, server-side
-- ---------------------------------------------------------------------------

/**
 * `INDRA-XXXX-XXXX-XXXX` from a 32-character alphabet that omits the pairs
 * people mistype (0/O, 1/I). 32 divides 256 exactly, so a byte modulo 32 has no
 * bias. Twelve characters of that alphabet is about 10^18 possibilities.
 */
create or replace function public.indra_key_code()
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out_text text := 'INDRA-';
  group_no int;
  char_no  int;
begin
  for group_no in 1..3 loop
    if group_no > 1 then
      out_text := out_text || '-';
    end if;
    for char_no in 1..4 loop
      out_text := out_text || substr(alphabet, (get_byte(extensions.gen_random_bytes(1), 0) % 32) + 1, 1);
    end loop;
  end loop;
  return out_text;
end;
$$;

/** The same normalisation the app applies: case and punctuation are not the key. */
create or replace function public.indra_key_hash(p_code text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(extensions.digest(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex')
$$;

-- ---------------------------------------------------------------------------
-- The console
-- ---------------------------------------------------------------------------

create or replace function public.indra_admin_create_keys(
  p_count int,
  p_label text default '',
  p_expires_at timestamptz default null
)
returns table (id uuid, code text, masked_code text, label text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  wanted int := greatest(1, least(coalesce(p_count, 1), 25));
  made   int := 0;
  plain  text;
  new_id uuid;
begin
  if not public.indra_is_admin() then
    raise exception 'not_an_administrator' using errcode = '42501';
  end if;

  while made < wanted loop
    plain := public.indra_key_code();
    begin
      insert into public.indra_activation_keys (code_hash, masked_code, label, expires_at, created_by)
      values (
        public.indra_key_hash(plain),
        'INDRA-' || repeat('•', 4) || '…' || right(regexp_replace(plain, '[^A-Za-z0-9]', '', 'g'), 4),
        coalesce(p_label, ''),
        p_expires_at,
        auth.uid()
      )
      returning indra_activation_keys.id into new_id;

      made := made + 1;
      id := new_id;
      code := plain;
      masked_code := (select k.masked_code from public.indra_activation_keys k where k.id = new_id);
      label := coalesce(p_label, '');
      expires_at := p_expires_at;
      return next;
    exception when unique_violation then
      -- Astronomically unlikely; try another code rather than fail the batch.
      continue;
    end;
  end loop;
end;
$$;

create or replace function public.indra_admin_keys()
returns table (
  id uuid,
  masked_code text,
  label text,
  created_at timestamptz,
  expires_at timestamptz,
  used_at timestamptz,
  used_by_email text,
  revoked_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select k.id, k.masked_code, k.label, k.created_at, k.expires_at, k.used_at, k.used_by_email, k.revoked_at
    from public.indra_activation_keys k
   where public.indra_is_admin()
   order by k.created_at desc
   limit 200
$$;

create or replace function public.indra_admin_revoke_key(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.indra_is_admin() then
    raise exception 'not_an_administrator' using errcode = '42501';
  end if;
  update public.indra_activation_keys set revoked_at = now() where id = p_id and revoked_at is null;
  return found;
end;
$$;

create or replace function public.indra_admin_delete_key(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.indra_is_admin() then
    raise exception 'not_an_administrator' using errcode = '42501';
  end if;
  delete from public.indra_activation_keys where id = p_id;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------

/**
 * Asked before the account exists — so it must be answerable by a caller who is
 * not signed in yet. It does not consume anything.
 */
create or replace function public.indra_check_activation_key(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.indra_activation_keys k
     where k.code_hash = public.indra_key_hash(p_code)
       and k.used_at is null
       and k.revoked_at is null
       and (k.expires_at is null or k.expires_at > now())
  )
$$;

/**
 * Called with the new account's own token, immediately after sign-up. It records
 * who used the key and when, and refuses a key that was taken in the meantime —
 * so two people racing for the same code cannot both get in.
 */
create or replace function public.indra_redeem_activation_key(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me    uuid := auth.uid();
  taken int;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  update public.indra_activation_keys k
     set used_at = now(),
         used_by = me,
         used_by_email = coalesce((select u.email from auth.users u where u.id = me), '')
   where k.code_hash = public.indra_key_hash(p_code)
     and k.used_at is null
     and k.revoked_at is null
     and (k.expires_at is null or k.expires_at > now());

  get diagnostics taken = row_count;
  return taken > 0;
end;
$$;

revoke all on function public.indra_admin_create_keys(int, text, timestamptz) from public, anon;
revoke all on function public.indra_admin_keys() from public, anon;
revoke all on function public.indra_admin_revoke_key(uuid) from public, anon;
revoke all on function public.indra_admin_delete_key(uuid) from public, anon;
revoke all on function public.indra_check_activation_key(text) from public;
revoke all on function public.indra_redeem_activation_key(text) from public, anon;

grant execute on function public.indra_admin_create_keys(int, text, timestamptz) to authenticated;
grant execute on function public.indra_admin_keys() to authenticated;
grant execute on function public.indra_admin_revoke_key(uuid) to authenticated;
grant execute on function public.indra_admin_delete_key(uuid) to authenticated;
-- Registration asks before there is a session, so the check must be open to
-- `anon`; it only ever answers yes or no, and it reveals nothing about a code
-- that does not exist.
grant execute on function public.indra_check_activation_key(text) to anon, authenticated;
grant execute on function public.indra_redeem_activation_key(text) to authenticated;
