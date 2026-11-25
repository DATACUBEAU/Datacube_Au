-- REVIEW ONLY; requires reward-ledger-candidate.sql in an isolated database first.
-- No production migration. Device registration and proof-of-possession are mandatory
-- before the authenticated server calls these service-only functions.
begin;
create table public.au_reward_leases (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (device_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  feature text not null check (feature in ('podcast','image','voice')),
  operation_id text not null check (operation_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  sequence bigint generated always as identity unique,
  units integer not null check (units > 0 and
    units <= case when feature='podcast' then 1800 else 10 end),
  consumed_units integer not null default 0 check(consumed_units between 0 and units),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  unique(account_id,device_id,feature,operation_id),
  check(expires_at > issued_at and expires_at <= issued_at + interval '7 days')
);
alter table public.au_reward_leases enable row level security;
revoke all on public.au_reward_leases from public, anon, authenticated;
grant select,insert,update on public.au_reward_leases to service_role;
grant usage,select on sequence public.au_reward_leases_sequence_seq to service_role;

-- The balance row lock serializes all allocations for this account/feature.
-- No automatic refund for abandoned/expired leases: otherwise a restored local
-- backup could spend an old allocation after the server returned it to the wallet.
create function public.au_allocate_reward_lease(p_account uuid,p_device text,p_feature text,p_operation text)
returns setof public.au_reward_leases language plpgsql security invoker set search_path='' as $$
declare
  existing public.au_reward_leases%rowtype;
  balance bigint;
  amount integer;
  issued timestamptz;
begin
  if p_account is null or p_device is null or p_operation is null or
     p_feature is null or p_feature not in ('podcast','image','voice') or
     p_device !~ '^[A-Za-z0-9_-]{16,128}$' or p_operation !~ '^[A-Za-z0-9_-]{16,128}$' then return; end if;
  select available_units into balance from public.au_reward_balances
    where account_id=p_account and feature=p_feature for update;
  if not found then return; end if;
  select * into existing from public.au_reward_leases where account_id=p_account
    and device_id=p_device and feature=p_feature and operation_id=p_operation;
  if found then return next existing; return; end if;
  if balance <= 0 then return; end if;
  -- Do not overwrite a still-usable device allocation.
  if exists(select 1 from public.au_reward_leases where account_id=p_account
    and device_id=p_device and feature=p_feature and expires_at>clock_timestamp()
    and consumed_units<units) then return; end if;
  amount := least(balance,case when p_feature='podcast' then 1800 else 10 end)::integer;
  issued := clock_timestamp();
  update public.au_reward_balances set available_units=available_units-amount
    where account_id=p_account and feature=p_feature;
  return query insert into public.au_reward_leases(account_id,device_id,feature,operation_id,units,issued_at,expires_at)
    values(p_account,p_device,p_feature,p_operation,amount,issued,issued+interval '7 days')
    returning *;
end;
$$;
revoke all on function public.au_allocate_reward_lease(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.au_allocate_reward_lease(uuid,text,text,text) to service_role;

-- Cumulative reported consumption is monotonic and idempotent.
-- Client reports cannot credit wallets or increase allocations.
create function public.au_reconcile_reward_lease(p_account uuid,p_device text,p_id uuid,p_consumed integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  update public.au_reward_leases set consumed_units=greatest(consumed_units,p_consumed)
   where id=p_id and account_id=p_account and device_id=p_device
     and p_consumed between 0 and units;
  get diagnostics changed=row_count;
  return changed=1;
end;
$$;
revoke all on function public.au_reconcile_reward_lease(uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.au_reconcile_reward_lease(uuid,text,uuid,integer) to service_role;
commit;
-- Test rollback, role grants, device ownership, allocation races and expired lease replay
-- before any migration. No free allowance reset policy or live device registration here.
