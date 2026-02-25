select
  id,
  status,
  worker_id,
  claimed_by,
  locked_at,
  locked_until,
  progress,
  document_id,
  owner_id,
  user_id,
  bucket,
  object_path,
  created_at,
  updated_at
from public.au_worker_jobs
order by updated_at desc
limit 50;

select
  id,
  status,
  file_name,
  file_path,
  owner_id,
  user_id,
  created_at,
  updated_at
from public.au_documents
order by updated_at desc
limit 25;

select
  document_id,
  count(*) as chunk_count
from public.au_document_chunks
group by document_id
order by chunk_count desc
limit 25;

select
  id,
  document_id,
  owner_id,
  file_path,
  processed,
  processed_at,
  created_at
from public.au_deletion_log
order by created_at desc
limit 25;

