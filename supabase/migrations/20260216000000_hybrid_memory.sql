-- Create memory_summaries table
create table if not exists memory_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('global', 'doc')),
  doc_id text, -- nullable because scope='global' has no doc_id
  summary text,
  pinned_facts jsonb default '[]'::jsonb,
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  
  -- constraint: doc_id is required if scope is 'doc'
  constraint doc_id_required_for_doc_scope check (
    (scope = 'doc' and doc_id is not null) or (scope = 'global')
  ),
  
  -- unique constraint to ensure one summary per scope/doc per user
  constraint unique_memory_summary unique (user_id, scope, doc_id)
);

-- Enable RLS
alter table memory_summaries enable row level security;

-- Policies
create policy "Users can read own memory summaries"
  on memory_summaries for select
  using (auth.uid() = user_id);

create policy "Users can insert/update own memory summaries"
  on memory_summaries for all
  using (auth.uid() = user_id);

-- Create admin_access_logs table for brute force protection
create table if not exists admin_access_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  ip_address text,
  attempt_count int default 1,
  locked_until timestamptz,
  last_attempt_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Index for fast lookup
create index idx_admin_access_logs_user_ip on admin_access_logs(user_id, ip_address);

-- Enable RLS
alter table admin_access_logs enable row level security;

-- Policy: only service role can really manage this, but we'll add a read policy for checking status
create policy "Service role full access"
  on admin_access_logs for all
  using ( auth.role() = 'service_role' );
