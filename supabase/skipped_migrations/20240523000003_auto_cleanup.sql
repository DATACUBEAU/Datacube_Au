-- Function to clean up RAG data (documents, chunks, embeddings) for inactive users
-- "Inactive" defined as last_active_at > 14 days ago

create or replace function cleanup_inactive_users_data()
returns void
language plpgsql
security definer
as $$
declare
  inactive_cutoff timestamp;
  deleted_count int;
begin
  inactive_cutoff := now() - interval '14 days';

  -- Delete documents for inactive users
  -- We assume ON DELETE CASCADE is set up for au_document_chunks -> au_documents
  -- If not, we would need to delete from chunks first.
  -- Safe approach: Delete from chunks first just in case.
  
  -- 1. Delete Chunks (Embeddings)
  with inactive_users as (
    select user_id from au_users where last_active_at < inactive_cutoff
  )
  delete from au_document_chunks
  where user_id in (select user_id from inactive_users);
  
  -- 2. Delete Documents (Metadata)
  with inactive_users as (
    select user_id from au_users where last_active_at < inactive_cutoff
  )
  delete from au_documents
  where user_id in (select user_id from inactive_users);

  get diagnostics deleted_count = row_count;
  raise notice 'Cleaned up documents for inactive users. Count: %', deleted_count;
end;
$$;

-- To enable this, you would typically run:
-- select cron.schedule('cleanup-inactive-data', '0 3 * * *', 'select cleanup_inactive_users_data()');
