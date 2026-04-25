BEGIN;

ALTER TABLE public.au_documents
  ADD COLUMN IF NOT EXISTS source_deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_cleanup_result text;

UPDATE public.au_documents
SET source_deleted_at = COALESCE(source_deleted_at, storage_deleted_at)
WHERE storage_deleted_at IS NOT NULL
  AND source_deleted_at IS NULL;

UPDATE public.au_documents
SET source_cleanup_result = 'deleted'
WHERE source_cleanup_result IS NULL
  AND COALESCE(source_deleted_at, storage_deleted_at) IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_au_documents_source_deleted_at
  ON public.au_documents (source_deleted_at);

NOTIFY pgrst, 'reload schema';

COMMIT;
