-- DataCube AU API key pipeline hardening
-- Adds server-only credential metadata and audit logging without exposing raw values.

create extension if not exists pgcrypto;

alter table if exists public.au_config
  add column if not exists stripe_price_weekly text default '',
  add column if not exists stripe_price_monthly text default '',
  add column if not exists stripe_price_weekly_id text,
  add column if not exists stripe_price_monthly_id text,
  add column if not exists bank_name text default '',
  add column if not exists bank_account_number text default '',
  add column if not exists bank_account_name text default '',
  add column if not exists bank_instructions text default '';

alter table if exists public.au_api_keys
  add column if not exists key_last4 text,
  add column if not exists key_fingerprint text,
  add column if not exists rotated_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid;

alter table if exists public.au_api_keys
  alter column key_value drop not null;

update public.au_api_keys
set key_last4 = right(key_value, 4)
where key_last4 is null
  and key_value is not null
  and length(key_value) >= 4;

update public.au_api_keys
set key_fingerprint = encode(digest(key_value, 'sha256'), 'hex')
where key_fingerprint is null
  and key_value is not null
  and length(key_value) > 0;

create table if not exists public.au_provider_key_audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('create', 'update', 'revoke', 'use', 'failure')),
  service text not null,
  provider_type text,
  key_fingerprint text,
  actor_user_id uuid,
  request_id text,
  created_at timestamptz not null default now()
);

alter table public.au_provider_key_audit_logs enable row level security;
revoke all on table public.au_provider_key_audit_logs from anon, authenticated;
grant all on table public.au_provider_key_audit_logs to service_role;

drop policy if exists "service role can manage provider key audit logs" on public.au_provider_key_audit_logs;
create policy "service role can manage provider key audit logs"
  on public.au_provider_key_audit_logs
  for all
  to service_role
  using (true)
  with check (true);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'au_api_keys',
    'ai_provider_keys',
    'au_key_groups',
    'au_admin_config',
    'au_admin_sessions'
  ]
  loop
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = table_name
        and c.relkind = 'r'
    ) then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all on table public.%I from anon, authenticated', table_name);
      execute format('grant all on table public.%I to service_role', table_name);
      execute format('drop policy if exists "server only credential access" on public.%I', table_name);
      execute format(
        'create policy "server only credential access" on public.%I for all to service_role using (true) with check (true)',
        table_name
      );
    end if;
  end loop;
end
$$;

do $$
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'ai_provider_keys'
      and c.relkind = 'r'
  ) then
    alter table public.ai_provider_keys
      add column if not exists key_last4 text,
      add column if not exists key_fingerprint text,
      add column if not exists rotated_at timestamptz,
      add column if not exists revoked_at timestamptz,
      add column if not exists created_by uuid,
      add column if not exists updated_by uuid;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'ai_provider_keys'
        and column_name = 'key_value'
    ) then
      update public.ai_provider_keys
      set key_last4 = right(key_value, 4)
      where key_last4 is null
        and key_value is not null
        and length(key_value) >= 4;

      update public.ai_provider_keys
      set key_fingerprint = encode(digest(key_value, 'sha256'), 'hex')
      where key_fingerprint is null
        and key_value is not null
        and length(key_value) > 0;
    end if;
  end if;

  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'au_key_groups'
      and c.relkind = 'r'
  ) then
    alter table public.au_key_groups
      add column if not exists api_key_last4 text,
      add column if not exists api_key_fingerprint text,
      add column if not exists rotated_at timestamptz,
      add column if not exists revoked_at timestamptz;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'au_key_groups'
        and column_name = 'api_key'
    ) then
      update public.au_key_groups
      set api_key_last4 = right(api_key, 4)
      where api_key_last4 is null
        and api_key is not null
        and length(api_key) >= 4;

      update public.au_key_groups
      set api_key_fingerprint = encode(digest(api_key, 'sha256'), 'hex')
      where api_key_fingerprint is null
        and api_key is not null
        and length(api_key) > 0;
    end if;
  end if;
end
$$;
