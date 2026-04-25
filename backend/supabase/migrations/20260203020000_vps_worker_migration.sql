-- Migration: VPS Worker System
-- 20260203020000_vps_worker_migration.sql

-- 1. Create au_worker_jobs table if missing (Recovery)
CREATE TABLE IF NOT EXISTS au_worker_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES au_documents(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    guest_session_id UUID,
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    progress INTEGER DEFAULT 0,
    worker_id TEXT DEFAULT 'firebase-worker',
    error TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE au_worker_jobs ENABLE ROW LEVEL SECURITY;

-- 2. Add lease-based locking columns to au_worker_jobs
ALTER TABLE au_worker_jobs 
ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS claimed_by TEXT,
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS bucket TEXT DEFAULT 'documents',
ADD COLUMN IF NOT EXISTS object_path TEXT;

-- 2. Create RPC for lease-based job claiming
CREATE OR REPLACE FUNCTION claim_worker_job(
  p_worker_id TEXT,
  p_lease_duration_ms INTEGER DEFAULT 300000 -- 5 minutes default
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
  -- Find a job that is 'queued' OR 'processing' but the lease has expired
  UPDATE au_worker_jobs
  SET 
    status = 'processing',
    locked_at = now(),
    locked_until = now() + (p_lease_duration_ms || ' milliseconds')::interval,
    claimed_by = p_worker_id,
    updated_at = now()
  WHERE id = (
    SELECT j.id
    FROM au_worker_jobs j
    WHERE 
      (j.status = 'queued')
      OR 
      (j.status = 'processing' AND j.locked_until < now())
    ORDER BY j.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING au_worker_jobs.id INTO v_job_id;

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
    FROM au_worker_jobs j
    WHERE j.id = v_job_id;
  END IF;
END;
$$;

-- 3. Update existing policies if necessary
-- Ensure service_role can do everything (already done in 20260131000000_worker_jobs_system.sql)
