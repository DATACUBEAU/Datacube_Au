-- DataCube AU provider key encrypted storage metadata
-- Adds nullable encrypted/provider-managed key columns without moving or deleting existing values.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'au_api_keys',
    'ai_provider_keys'
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
      execute format(
        'alter table public.%I
          add column if not exists encrypted_key_value text,
          add column if not exists key_encryption_version text,
          add column if not exists key_encrypted_at timestamptz,
          add column if not exists key_reference text',
        table_name
      );

      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all on table public.%I from anon, authenticated', table_name);
      execute format('grant all on table public.%I to service_role', table_name);
    end if;
  end loop;
end
$$;

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'au_key_groups'
      and c.relkind = 'r'
  ) then
    alter table public.au_key_groups
      add column if not exists encrypted_api_key text,
      add column if not exists api_key_encryption_version text,
      add column if not exists api_key_encrypted_at timestamptz,
      add column if not exists api_key_reference text;

    alter table public.au_key_groups enable row level security;
    revoke all on table public.au_key_groups from anon, authenticated;
    grant all on table public.au_key_groups to service_role;
  end if;
end
$$;
