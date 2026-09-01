-- Enable necessary extensions
create extension if not exists vector;
create extension if not exists pgcrypto;

-- Documents table
create table au_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  document_type text not null,
  file_name text not null,
  file_path text not null,
  status text not null default 'uploading',
  parent_id uuid references au_documents(id),
  created_at timestamptz default now(),
  expires_at timestamptz,
  error text
);

alter table au_documents enable row level security;

create policy "Users can view own documents"
  on au_documents for select
  using (auth.uid() = user_id);

create policy "Users can insert own documents"
  on au_documents for insert
  with check (auth.uid() = user_id);

create policy "Users can update own documents"
  on au_documents for update
  using (auth.uid() = user_id);

create policy "Users can delete own documents"
  on au_documents for delete
  using (auth.uid() = user_id);

-- Document Chunks table (for RAG)
create table au_document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references au_documents(id) on delete cascade not null,
  user_id uuid references auth.users not null,
  chunk_index int not null,
  text text not null,
  embedding vector(1536), -- assuming OpenAI ada-002 or similar
  created_at timestamptz default now()
);

alter table au_document_chunks enable row level security;

create policy "Users can view own chunks"
  on au_document_chunks for select
  using (auth.uid() = user_id);

-- API Keys table (Encrypted storage)
-- Only service_role should access this table to retrieve keys for Edge Functions
create table au_api_keys (
  service text primary key,
  key_value text not null, -- This should be encrypted by the application or inserted via dashboard
  created_at timestamptz default now()
);

alter table au_api_keys enable row level security;

-- Only allow service_role to access keys
create policy "Service role can access keys"
  on au_api_keys
  for all
  to service_role
  using (true)
  with check (true);

-- Similarity Search Function
create or replace function match_documents (
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_user_id uuid
)
returns table (
  id uuid,
  text text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    au_document_chunks.id,
    au_document_chunks.text,
    1 - (au_document_chunks.embedding <=> query_embedding) as similarity
  from au_document_chunks
  where au_document_chunks.user_id = p_user_id
  and 1 - (au_document_chunks.embedding <=> query_embedding) > match_threshold
  order by au_document_chunks.embedding <=> query_embedding
  limit match_count;
end;
$$;
