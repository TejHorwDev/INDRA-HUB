-- ---------------------------------------------------------------------------
-- INDRA HUB — handing the workspace to the account that edits it (revised)
--
-- Two things went wrong with the first version of this:
--
--   1. `indra_workspace_touch` keeps `owner_uid` with
--      `coalesce(old.owner_uid, new.owner_uid)`. Once a row has an owner it can
--      never lose one — good, that stops a client clearing ownership, and it
--      also means handing the workspace to a *different* account was impossible.
--   2. The obvious repair is a function that reassigns the row. But the trigger
--      sits in front of every update, including the definer functions.
--
-- So the trigger now honours one session setting, `indra.workspace_reassign`,
-- which only a definer function turns on. With it off — every ordinary write,
-- including a client's PATCH — ownership is still frozen exactly as before: a
-- signed-in owner cannot pass their role to someone else by editing the row,
-- and a non-owner cannot write the row at all.
--
-- With it on, the administrator function below sets the owner explicitly. It
-- asks for two things the server already trusts:
--
--   * the caller holds `role = 'admin'` on `indra_users` — the role
--     `indra_claim_admin()` gives out, and only once;
--   * the account being appointed has a cloud profile, so it can actually use
--     the ownership it is given.
--
-- Run after workspace.sql and auth.sql.
-- ---------------------------------------------------------------------------

create or replace function public.indra_workspace_touch()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);

  /*
   * Ownership is frozen unless a definer function is deliberately moving it.
   * `old.owner_uid` wins over anything a caller sends.
   */
  if coalesce(current_setting('indra.workspace_reassign', true), 'off') <> 'on' then
    new.owner_uid := coalesce(old.owner_uid, new.owner_uid);
  end if;

  return new;
end
$$;

create or replace function public.indra_claim_workspace_as_admin(p_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me   text := public.indra_uid();
  v_role text;
  v_rows integer;
begin
  if v_me is null then
    raise exception 'Sign in before claiming the workspace.' using errcode = '28000';
  end if;

  select u.role into v_role from public.indra_users u where u.id = v_me;

  if v_role is distinct from 'admin' then
    raise exception 'Only an administrator can hand over the workspace.' using errcode = '42501';
  end if;

  if p_owner is null then
    raise exception 'Name the account that should own the workspace.';
  end if;

  if not exists (select 1 from public.indra_users u where u.auth_user_id = p_owner) then
    raise exception 'That account has no cloud profile yet.';
  end if;

  -- The one place ownership may move. Turned back off immediately, so the rest
  -- of this transaction behaves like every other write.
  perform set_config('indra.workspace_reassign', 'on', true);

  update public.indra_workspace
     set owner_uid = p_owner,
         claim_hash = null
   where id = 'primary';

  get diagnostics v_rows = row_count;

  perform set_config('indra.workspace_reassign', 'off', true);

  return jsonb_build_object(
    'claimed', v_rows = 1,
    'ownerUid', p_owner,
    'reason', case when v_rows = 1 then null else 'The workspace row is missing.' end
  );
end
$$;

revoke all on function public.indra_claim_workspace_as_admin(uuid) from public, anon;
grant execute on function public.indra_claim_workspace_as_admin(uuid) to authenticated;
