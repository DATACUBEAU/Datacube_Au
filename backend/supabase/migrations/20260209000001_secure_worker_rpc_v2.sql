
-- Secure Worker RPC: Revoke Public Access, Qualify Names, and Set Safe Search Path
-- Timestamp: 20260209000001

-- 1. Redefine the function with fully qualified names (public.*)
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
SET search_path = '' -- Production Hardening: Empty search path
AS $$
DECLARE
  v_job_id UUID;
BEGIN
  -- Find a job that is 'queued' OR 'processing' but the lease has expired
  UPDATE public.au_worker_jobs
  SET 
    status = 'processing',
    locked_at = now(),
    locked_until = now() + (p_lease_duration_ms || ' milliseconds')::interval,
    claimed_by = p_worker_id,
    updated_at = now()
  WHERE public.au_worker_jobs.id = (
    SELECT j.id
    FROM public.au_worker_jobs j
    WHERE 
      (j.status = 'queued')
      OR 
      (j.status = 'processing' AND j.locked_until < now())
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

-- 2. Lockdown Permissions
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT oid::regprocedure as func_signature
        FROM pg_proc 
        WHERE proname = 'claim_worker_job'
    LOOP
        EXECUTE 'REVOKE ALL ON FUNCTION ' || r.func_signature || ' FROM PUBLIC';
        RAISE NOTICE 'Revoked permissions from PUBLIC on %', r.func_signature;
        
        -- Grant to service_role only
        EXECUTE 'GRANT EXECUTE ON FUNCTION ' || r.func_signature || ' TO service_role';
        RAISE NOTICE 'Granted permissions to service_role on %', r.func_signature;
    END LOOP;
END $$;
