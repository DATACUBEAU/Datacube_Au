create extension if not exists pgcrypto;

alter table if exists public.au_upload_jobs
  add column if not exists error text;

create table if not exists public.au_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  entity_id text not null,
  user_id text not null,
  timestamp timestamptz not null default now(),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  begin
    alter publication supabase_realtime add table public.au_events;
  exception
    when duplicate_object then null;
  end;
exception
  when undefined_object then null;
end $$;

create index if not exists idx_au_events_user_id on public.au_events(user_id);
create index if not exists idx_au_events_event_type on public.au_events(event_type);
create index if not exists idx_au_events_timestamp on public.au_events(timestamp desc);

alter table public.au_events disable row level security;

create table if not exists public.au_model_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  guest_session_id uuid references public.au_guest_sessions(id) on delete set null,
  feature text not null,
  model_id text not null,
  prompt_tokens int,
  completion_tokens int,
  total_tokens int,
  cost double precision,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_au_model_usage_user_id on public.au_model_usage(user_id);
create index if not exists idx_au_model_usage_guest_session_id on public.au_model_usage(guest_session_id);
create index if not exists idx_au_model_usage_feature on public.au_model_usage(feature);
create index if not exists idx_au_model_usage_created_at on public.au_model_usage(created_at desc);

alter table public.au_model_usage enable row level security;

do $$
begin
  begin
    create policy "Users can view own model usage" on public.au_model_usage
      for select
      using (auth.uid() = user_id);
  exception
    when duplicate_object then null;
  end;
end $$;

