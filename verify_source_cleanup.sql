-- Check new columns in au_documents
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'au_documents' 
  AND column_name IN ('source_deleted_at', 'source_cleanup_result');

-- Check if the index exists
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'au_documents' 
  AND indexname = 'idx_au_documents_source_deleted_at';

-- Verify backfill for records that had storage_deleted_at
SELECT id, storage_deleted_at, source_deleted_at, source_cleanup_result 
FROM public.au_documents 
WHERE storage_deleted_at IS NOT NULL 
LIMIT 10;
