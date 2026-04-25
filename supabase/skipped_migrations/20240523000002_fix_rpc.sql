
create or replace function au_vector_search(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_user_id uuid default null,
  p_guest_session_id uuid default null
)
returns table (
  chunk_id uuid,
  document_id uuid,
  file_name text,
  text text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    c.id as chunk_id,
    c.document_id,
    d.file_name,
    c.text,
    1 - (e.embedding <=> query_embedding) as similarity
  from au_document_embeddings e
  join au_document_chunks c on e.chunk_id = c.id
  join au_documents d on c.document_id = d.id
  where 1 - (e.embedding <=> query_embedding) > match_threshold
  and (
    -- If p_user_id is provided, match it
    (p_user_id is not null and d.user_id = p_user_id)
    or
    -- If p_guest_session_id is provided, match it
    (p_guest_session_id is not null and d.guest_session_id = p_guest_session_id)
    or
    -- If neither is provided (admin/service role call), return everything? 
    -- Better to be strict: if both null, return nothing or public docs (if any)
    (p_user_id is null and p_guest_session_id is null)
  )
  order by e.embedding <=> query_embedding
  limit match_count;
end;
$$;
