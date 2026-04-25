BEGIN;

ALTER TABLE public.au_worker_jobs
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_progress_at timestamptz;

ALTER TABLE public.au_worker_jobs
  ALTER COLUMN bucket SET DEFAULT 'documents';

UPDATE public.au_worker_jobs
SET bucket = 'documents'
WHERE bucket IS NULL OR btrim(bucket) = '';

UPDATE public.au_worker_jobs
SET last_progress_at = COALESCE(last_progress_at, updated_at, created_at, now())
WHERE last_progress_at IS NULL;

UPDATE public.au_worker_jobs
SET completed_at = COALESCE(completed_at, updated_at, last_progress_at, created_at, now())
WHERE status IN ('completed', 'done')
  AND completed_at IS NULL;

CREATE OR REPLACE FUNCTION public.sync_au_worker_job_lifecycle_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := COALESCE(NEW.updated_at, NEW.created_at, now());
    NEW.bucket := COALESCE(NULLIF(btrim(NEW.bucket), ''), 'documents');
    NEW.last_progress_at := COALESCE(NEW.last_progress_at, NEW.updated_at, NEW.created_at, now());

    IF COALESCE(lower(NEW.status), '') IN ('completed', 'done') THEN
      NEW.completed_at := COALESCE(NEW.completed_at, NEW.updated_at, NEW.last_progress_at, NEW.created_at, now());
    END IF;

    RETURN NEW;
  END IF;

  NEW.updated_at := COALESCE(NEW.updated_at, now());
  NEW.bucket := COALESCE(NULLIF(btrim(NEW.bucket), ''), COALESCE(OLD.bucket, 'documents'), 'documents');

  IF NEW.progress IS DISTINCT FROM OLD.progress OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.last_progress_at := COALESCE(NEW.last_progress_at, NEW.updated_at, now());
  ELSE
    NEW.last_progress_at := COALESCE(NEW.last_progress_at, OLD.last_progress_at, NEW.updated_at, now());
  END IF;

  IF COALESCE(lower(NEW.status), '') IN ('completed', 'done') THEN
    NEW.completed_at := COALESCE(NEW.completed_at, OLD.completed_at, NEW.updated_at, NEW.last_progress_at, now());
  ELSE
    NEW.completed_at := COALESCE(NEW.completed_at, OLD.completed_at);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_au_worker_job_lifecycle_fields ON public.au_worker_jobs;

CREATE TRIGGER trg_sync_au_worker_job_lifecycle_fields
BEFORE INSERT OR UPDATE ON public.au_worker_jobs
FOR EACH ROW
EXECUTE FUNCTION public.sync_au_worker_job_lifecycle_fields();

CREATE INDEX IF NOT EXISTS idx_au_worker_jobs_processing_completion_reconcile
  ON public.au_worker_jobs (status, progress, last_progress_at)
  WHERE status = 'processing' AND progress = 100;

NOTIFY pgrst, 'reload schema';

COMMIT;
