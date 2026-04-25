-- Worker Pipeline Hardening
-- Ensures required chunk/job/cleanup schema exists and is indexed for VPS worker reliability.

CREATE TABLE IF NOT EXISTS public.au_document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.au_documents(id) ON DELETE CASCADE,
  owner_id uuid,
  user_id uuid,
  chunk_index integer NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.au_document_chunks
  ADD COLUMN IF NOT EXISTS owner_id uuid,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS chunk_index integer,
  ADD COLUMN IF NOT EXISTS text text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'au_document_chunks' AND column_name = 'owner_id'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'au_document_chunks' AND column_name = 'user_id'
  ) THEN
    EXECUTE 'update public.au_document_chunks set owner_id = coalesce(owner_id, user_id), user_id = coalesce(user_id, owner_id) where owner_id is null or user_id is null';
  END IF;
END $$;

ALTER TABLE public.au_document_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own chunks" ON public.au_document_chunks;
DROP POLICY IF EXISTS "Users can insert own chunks" ON public.au_document_chunks;
DROP POLICY IF EXISTS "Users can update own chunks" ON public.au_document_chunks;
DROP POLICY IF EXISTS "Users can delete own chunks" ON public.au_document_chunks;

CREATE POLICY "Users can view own chunks" ON public.au_document_chunks
  FOR SELECT
  USING (auth.uid() = coalesce(owner_id, user_id));

CREATE POLICY "Users can insert own chunks" ON public.au_document_chunks
  FOR INSERT
  WITH CHECK (auth.uid() = coalesce(owner_id, user_id));

CREATE POLICY "Users can update own chunks" ON public.au_document_chunks
  FOR UPDATE
  USING (auth.uid() = coalesce(owner_id, user_id));

CREATE POLICY "Users can delete own chunks" ON public.au_document_chunks
  FOR DELETE
  USING (auth.uid() = coalesce(owner_id, user_id));

CREATE INDEX IF NOT EXISTS idx_au_document_chunks_document
  ON public.au_document_chunks (document_id);

CREATE INDEX IF NOT EXISTS idx_au_document_chunks_owner_document
  ON public.au_document_chunks (owner_id, document_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_au_document_chunks_user_document
  ON public.au_document_chunks (user_id, document_id, chunk_index);

CREATE UNIQUE INDEX IF NOT EXISTS uq_au_document_chunks_owner_doc_idx
  ON public.au_document_chunks (document_id, owner_id, chunk_index)
  WHERE owner_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_au_document_chunks_user_doc_idx
  ON public.au_document_chunks (document_id, user_id, chunk_index)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.au_worker_jobs
  ADD COLUMN IF NOT EXISTS owner_id uuid,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS object_path text,
  ADD COLUMN IF NOT EXISTS bucket text DEFAULT 'documents';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'au_worker_jobs' AND column_name = 'user_id'
  ) THEN
    EXECUTE 'update public.au_worker_jobs set owner_id = coalesce(owner_id, user_id) where owner_id is null';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_au_worker_jobs_claim_scan
  ON public.au_worker_jobs (status, worker_id, created_at);

CREATE INDEX IF NOT EXISTS idx_au_worker_jobs_lease_scan
  ON public.au_worker_jobs (status, locked_until);

CREATE INDEX IF NOT EXISTS idx_au_worker_jobs_owner_document
  ON public.au_worker_jobs (owner_id, document_id);

ALTER TABLE public.au_documents
  ADD COLUMN IF NOT EXISTS cleanup_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cleanup_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cleanup_last_error text,
  ADD COLUMN IF NOT EXISTS cleanup_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS storage_deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_au_documents_cleanup_status
  ON public.au_documents (status, cleanup_pending, created_at);

CREATE INDEX IF NOT EXISTS idx_au_documents_storage_deleted
  ON public.au_documents (storage_deleted_at);

CREATE OR REPLACE FUNCTION public.reload_schema_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
END;
$$;

GRANT EXECUTE ON FUNCTION public.reload_schema_cache() TO service_role;
SELECT public.reload_schema_cache();
