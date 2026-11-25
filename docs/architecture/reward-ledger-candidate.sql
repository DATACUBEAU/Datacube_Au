-- REVIEW CANDIDATE ONLY. Not a production migration.
-- Test in isolated Supabase/Postgres with concurrent grants and role checks.
-- Apply through the normal migration process after review.
begin;
create table public.au_reward_intents (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{16,128}$'),
  account_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature in ('podcast','image','voice')),
  provider text not null check (provider in ('admob','startio')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create table public.au_reward_grants (
  intent_id text primary key references public.au_reward_intents(id) on delete cascade,
  provider text not null check (provider in ('admob','startio')),
  transaction_id text not null check (length(transaction_id) between 1 and 256),
  account_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature in ('podcast','image','voice')),
  units integer not null check (
    (feature='podcast' and units=1800) or
    (feature in ('image','voice') and units=10)
  ),
  granted_at timestamptz not null default now(),
  unique(provider, transaction_id)
);
create table public.au_reward_balances (
  account_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature in ('podcast','image','voice')),
  available_units bigint not null default 0 check (available_units >= 0),
  primary key(account_id, feature)
);
create index au_reward_intents_account_idx on public.au_reward_intents(account_id);
create index au_reward_grants_account_idx on public.au_reward_grants(account_id);
alter table public.au_reward_intents enable row level security;
alter table public.au_reward_grants enable row level security;
alter table public.au_reward_balances enable row level security;
revoke all on public.au_reward_intents, public.au_reward_grants, public.au_reward_balances from public, anon, authenticated;
grant select, insert, update, delete on public.au_reward_intents, public.au_reward_grants, public.au_reward_balances to service_role;

-- Only the server may invoke this after cryptographic provider verification.
-- The intent determines ownership, feature and amount. Never trust client units.
create function public.au_grant_verified_reward(p_intent text, p_provider text, p_transaction text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  intent public.au_reward_intents%rowtype;
  amount integer;
  inserted_count integer;
begin
  if p_intent is null or p_provider is null or p_transaction is null or
      length(p_transaction) not between 1 and 256 then return 'rejected'; end if;
  select * into intent from public.au_reward_intents
    where id=p_intent for update;
  if not found or intent.provider <> p_provider then return 'rejected'; end if;
  if exists(select 1 from public.au_reward_grants
      where intent_id=p_intent or (provider=p_provider and transaction_id=p_transaction))
    then return 'duplicate'; end if;
  if intent.expires_at <= clock_timestamp() then return 'rejected'; end if;
  amount := case intent.feature when 'podcast' then 1800 else 10 end;
  insert into public.au_reward_grants(intent_id,provider,transaction_id,account_id,feature,units)
    values(intent.id,intent.provider,p_transaction,intent.account_id,intent.feature,amount)
    on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count=0 then return 'duplicate'; end if;
  insert into public.au_reward_balances(account_id,feature,available_units)
    values(intent.account_id,intent.feature,amount)
    on conflict(account_id,feature) do update
      set available_units=public.au_reward_balances.available_units+excluded.available_units;
  return 'granted';
end;
$$;
revoke all on function public.au_grant_verified_reward(text,text,text) from public, anon, authenticated;
grant execute on function public.au_grant_verified_reward(text,text,text) to service_role;
commit;
-- Future: authenticated server intent creation, rate limits, trusted key rotation,
-- signed device leases, initial allocations, consumption/reconciliation and owner-only reporting.
