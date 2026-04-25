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
SET search_path = ''
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
  WHERE public.au_worker_jobs.id = (
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
      NULL::uuid AS guest_session_id,
      j.bucket,
      j.object_path,
      j.metadata
    FROM public.au_worker_jobs j
    WHERE j.id = v_job_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_upload_job()
RETURNS TABLE (
  job_id uuid,
  document_id uuid,
  user_id uuid,
  guest_session_id uuid,
  file_name text,
  bucket text,
  object_path text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    j.id AS job_id,
    j.document_id,
    j.user_id,
    NULL::uuid AS guest_session_id,
    j.file_name,
    j.bucket,
    j.object_path
  FROM public.claim_worker_job('claim_upload_job', 300000) j;
END;
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS func_signature
    FROM pg_proc
    WHERE proname IN ('claim_worker_job', 'claim_upload_job')
  LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || r.func_signature || ' FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || r.func_signature || ' TO service_role';
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
