create extension if not exists pgcrypto;

create table if not exists public.au_api_keys (
  service text primary key,
  provider_type text not null default 'openrouter',
  key_value text,
  is_active boolean not null default true,
  allowed_models text[] default null,
  metadata jsonb not null default '{}'::jsonb,
  error_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.au_api_keys add column if not exists provider_type text default 'openrouter';
alter table public.au_api_keys add column if not exists key_value text;
alter table public.au_api_keys add column if not exists is_active boolean default true;
alter table public.au_api_keys add column if not exists allowed_models text[] default null;
alter table public.au_api_keys add column if not exists metadata jsonb default '{}'::jsonb;
alter table public.au_api_keys add column if not exists error_count integer default 0;
alter table public.au_api_keys add column if not exists last_used_at timestamptz;
alter table public.au_api_keys add column if not exists created_at timestamptz default now();
alter table public.au_api_keys add column if not exists updated_at timestamptz default now();

create table if not exists public.au_models_registry (
  model_id text primary key,
  display_name text not null,
  provider text not null default 'openrouter',
  type text not null default 'chat',
  is_free boolean not null default false,
  is_active boolean not null default true,
  context_window integer not null default 4096,
  rate_limit_rpm integer not null default 20,
  rate_limit_tpm integer not null default 100000,
  usage_constraints jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.au_models_registry add column if not exists display_name text;
alter table public.au_models_registry add column if not exists provider text default 'openrouter';
alter table public.au_models_registry add column if not exists type text default 'chat';
alter table public.au_models_registry add column if not exists is_free boolean default false;
alter table public.au_models_registry add column if not exists is_active boolean default true;
alter table public.au_models_registry add column if not exists context_window integer default 4096;
alter table public.au_models_registry add column if not exists rate_limit_rpm integer default 20;
alter table public.au_models_registry add column if not exists rate_limit_tpm integer default 100000;
alter table public.au_models_registry add column if not exists usage_constraints jsonb default '{}'::jsonb;
alter table public.au_models_registry add column if not exists created_at timestamptz default now();
alter table public.au_models_registry add column if not exists updated_at timestamptz default now();

create table if not exists public.au_pro_models_registry (
  model_id text primary key,
  display_name text not null,
  provider text not null default 'openrouter',
  type text not null default 'chat',
  is_free boolean not null default false,
  is_active boolean not null default true,
  context_window integer not null default 4096,
  rate_limit_rpm integer not null default 20,
  rate_limit_tpm integer not null default 100000,
  usage_constraints jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.au_pro_models_registry add column if not exists display_name text;
alter table public.au_pro_models_registry add column if not exists provider text default 'openrouter';
alter table public.au_pro_models_registry add column if not exists type text default 'chat';
alter table public.au_pro_models_registry add column if not exists is_free boolean default false;
alter table public.au_pro_models_registry add column if not exists is_active boolean default true;
alter table public.au_pro_models_registry add column if not exists context_window integer default 4096;
alter table public.au_pro_models_registry add column if not exists rate_limit_rpm integer default 20;
alter table public.au_pro_models_registry add column if not exists rate_limit_tpm integer default 100000;
alter table public.au_pro_models_registry add column if not exists usage_constraints jsonb default '{}'::jsonb;
alter table public.au_pro_models_registry add column if not exists created_at timestamptz default now();
alter table public.au_pro_models_registry add column if not exists updated_at timestamptz default now();

create index if not exists idx_au_models_registry_active on public.au_models_registry(is_active);
create index if not exists idx_au_pro_models_registry_active on public.au_pro_models_registry(is_active);

create table if not exists public.au_admin_email_alerts (
  id uuid primary key default gen_random_uuid(),
  event_type text not null unique,
  recipients text[] not null default '{}'::text[],
  is_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.au_admin_email_alerts add column if not exists event_type text;
alter table public.au_admin_email_alerts add column if not exists recipients text[] default '{}'::text[];
alter table public.au_admin_email_alerts add column if not exists is_enabled boolean default false;
alter table public.au_admin_email_alerts add column if not exists created_at timestamptz default now();
alter table public.au_admin_email_alerts add column if not exists updated_at timestamptz default now();

create unique index if not exists idx_au_admin_email_alerts_event_type
  on public.au_admin_email_alerts(event_type);

insert into public.au_admin_email_alerts (event_type, recipients, is_enabled)
values
  ('admin_login_failed', '{}'::text[], true),
  ('critical_error', '{}'::text[], true),
  ('billing_failure', '{}'::text[], false),
  ('api_key_exhausted', '{}'::text[], false)
on conflict (event_type) do nothing;

create table if not exists public.au_debug_logs (
  id uuid primary key default gen_random_uuid(),
  level text not null default 'info',
  source text,
  message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.au_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  entity_id text not null default 'system',
  user_id text,
  timestamp timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.au_events add column if not exists entity_id text;
alter table public.au_events add column if not exists event_type text;
alter table public.au_events add column if not exists user_id text;
alter table public.au_events add column if not exists timestamp timestamptz default now();
alter table public.au_events add column if not exists metadata jsonb default '{}'::jsonb;
alter table public.au_events add column if not exists created_at timestamptz default now();

update public.au_events
set entity_id = coalesce(nullif(entity_id, ''), 'system')
where entity_id is null or entity_id = '';

alter table public.au_events alter column entity_id set default 'system';
alter table public.au_events alter column entity_id set not null;

create index if not exists idx_au_events_user_id on public.au_events(user_id);
create index if not exists idx_au_events_event_type on public.au_events(event_type);
create index if not exists idx_au_events_timestamp on public.au_events(timestamp desc);

drop function if exists public.reload_schema_cache();

create or replace function public.reload_schema_cache()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  perform pg_notify('pgrst', 'reload schema');
end;
$$;

grant execute on function public.reload_schema_cache() to authenticated, service_role;
