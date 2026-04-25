-- Migration: Remove Firebase ingestion pipeline artifacts
-- Date: 2026-02-03

-- 1) Remove deprecated storage trigger and RPC used by Firebase ingestion worker
DROP TRIGGER IF EXISTS on_upload_job_trigger ON storage.objects;
DROP FUNCTION IF EXISTS public.on_storage_upload_enqueue();
DROP FUNCTION IF EXISTS public.claim_ingestion_job(UUID, TEXT);

-- 2) Remove deprecated Firebase queue tables
DROP TABLE IF EXISTS public.ingestion_jobs;
-- Keep au_worker_jobs as it is used by the new VPS worker
-- DROP TABLE IF EXISTS public.au_worker_jobs;

-- 3) Remove now-unused enum type
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
    DROP TYPE job_status;
  END IF;
END $$;

-- 4) Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
