begin;

alter table public.au_payments add column if not exists owner_id uuid;
alter table public.au_payments add column if not exists amount_ngn numeric;
alter table public.au_payments add column if not exists reference text;
alter table public.au_payments add column if not exists channel text;
alter table public.au_payments add column if not exists metadata jsonb default '{}'::jsonb;
alter table public.au_payments add column if not exists confirmed_at timestamptz;

do $$
declare
  has_user_id boolean;
  has_owner_id boolean;
  has_amount boolean;
  has_amount_ngn boolean;
  has_reference boolean;
  has_provider_ref boolean;
  has_reference_code boolean;
  has_channel boolean;
  has_provider boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'au_payments' and column_name = 'user_id'
  ) into has_user_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'au_payments' and column_name = 'owner_id'
  ) into has_owner_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'au_payments' and column_name = 'amount'
  ) into has_amount;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'au_payments' and column_name = 'amount_ngn'
  ) into has_amount_ngn;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'au_payments' and column_name = 'reference'
  ) into has_reference;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'au_payments' and column_name = 'provider_ref'
  ) into has_provider_ref;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'au_payments' and column_name = 'reference_code'
  ) into has_reference_code;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'au_payments' and column_name = 'channel'
  ) into has_channel;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'au_payments' and column_name = 'provider'
  ) into has_provider;

  if has_owner_id and has_user_id then
    execute 'update public.au_payments set owner_id = coalesce(owner_id, user_id) where owner_id is null';
  end if;

  if has_amount_ngn and has_amount then
    execute 'update public.au_payments set amount_ngn = coalesce(amount_ngn, amount) where amount_ngn is null';
  end if;

  if has_reference then
    if has_provider_ref and has_reference_code then
      execute 'update public.au_payments set reference = coalesce(reference, provider_ref, reference_code) where reference is null';
    elsif has_provider_ref then
      execute 'update public.au_payments set reference = coalesce(reference, provider_ref) where reference is null';
    elsif has_reference_code then
      execute 'update public.au_payments set reference = coalesce(reference, reference_code) where reference is null';
    end if;
  end if;

  if has_channel then
    if has_provider then
      execute $channel_update$
        update public.au_payments
        set channel = coalesce(channel, case when provider = 'manual' then 'bank_transfer' else 'card' end)
        where channel is null
      $channel_update$;
    else
      execute 'update public.au_payments set channel = coalesce(channel, ''card'') where channel is null';
    end if;
  end if;
end $$;

alter table public.au_worker_jobs add column if not exists owner_id uuid;

do $$
declare
  has_user_id boolean;
  has_owner_id boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'au_worker_jobs' and column_name = 'user_id'
  ) into has_user_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'au_worker_jobs' and column_name = 'owner_id'
  ) into has_owner_id;

  if has_owner_id and has_user_id then
    execute 'update public.au_worker_jobs set owner_id = coalesce(owner_id, user_id) where owner_id is null';
  end if;
end $$;

create index if not exists idx_au_payments_owner_id on public.au_payments(owner_id);
create index if not exists idx_au_worker_jobs_owner_id on public.au_worker_jobs(owner_id);

commit;
