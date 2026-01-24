CREATE OR REPLACE FUNCTION claim_upload_job()
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
AS $$
DECLARE
  claimed_job_id uuid;
BEGIN
  -- Select one queued job and lock it
  -- FOR UPDATE SKIP LOCKED prevents multiple workers from claiming the same job
  SELECT id INTO claimed_job_id
  FROM au_upload_jobs
  WHERE status = 'queued'
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF claimed_job_id IS NOT NULL THEN
    -- Update status to processing immediately
    -- Reset progress to 10 to match Edge Function behavior and fix UI confusion
    UPDATE au_upload_jobs
    SET status = 'processing',
        progress = 10,
        updated_at = now()
    WHERE id = claimed_job_id;

    -- Log claim
    INSERT INTO au_debug_logs (component, message, details)
    VALUES ('claim_upload_job', 'Job claimed by worker', jsonb_build_object('job_id', claimed_job_id));

    RETURN QUERY
    SELECT 
      j.id, 
      j.document_id, 
      j.user_id, 
      j.guest_session_id,
      j.file_name, 
      j.bucket, 
      j.object_path
    FROM au_upload_jobs j
    WHERE j.id = claimed_job_id;
  END IF;
END;
$$;
