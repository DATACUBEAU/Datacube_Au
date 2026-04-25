ALTER TABLE public.au_worker_jobs
  ALTER COLUMN worker_id SET DEFAULT 'vps-worker';

CREATE OR REPLACE FUNCTION public.claim_worker_job(
  p_worker_id TEXT,
  p_lease_duration_ms INTEGER DEFAULT 300000
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  user_id UUID,
  guest_session_id UUID,
  bucket TEXT,
  object_path TEXT,
  metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job_id UUID;
BEGIN
  UPDATE public.au_worker_jobs
  SET
    status = 'processing',
    worker_id = COALESCE(public.au_worker_jobs.worker_id, 'vps-worker'),
    locked_at = now(),
    locked_until = now() + (p_lease_duration_ms || ' milliseconds')::interval,
    claimed_by = p_worker_id,
    updated_at = now()
  WHERE id = (
    SELECT j.id
    FROM public.au_worker_jobs j
    WHERE
      (
        j.status IN ('queued', 'uploaded')
        AND (j.worker_id IS NULL OR j.worker_id = 'vps-worker')
      )
      OR
      (
        j.status = 'processing'
        AND (j.locked_until IS NULL OR j.locked_until < now())
        AND (j.worker_id IS NULL OR j.worker_id = 'vps-worker')
      )
    ORDER BY j.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING public.au_worker_jobs.id INTO v_job_id;

  IF v_job_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      j.id,
      j.document_id,
      j.user_id,
      j.guest_session_id,
      j.bucket,
      j.object_path,
      j.metadata
    FROM public.au_worker_jobs j
    WHERE j.id = v_job_id;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
