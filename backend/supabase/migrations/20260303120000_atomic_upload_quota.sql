-- Migration: 20260303120000_atomic_upload_quota.sql

-- 1. Update finalize_document_upload to include quota enforcement
CREATE OR REPLACE FUNCTION public.finalize_document_upload(
  p_owner_id uuid,
  p_document_id uuid,
  p_upload_id uuid,
  p_job_id uuid,
  p_bucket text,
  p_object_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc record;
  v_job_id uuid;
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
  v_now TIMESTAMPTZ := now();
  v_tier TEXT := 'free';
  v_limits JSONB;
  v_max_docs INT;
  v_max_uploads_daily INT;
  v_max_storage_mb INT;
  v_current_docs INT;
  v_current_uploads_daily INT;
  v_current_storage_mb NUMERIC;
  v_file_mb NUMERIC;
  v_usage_day JSONB;
BEGIN
  -- Validation
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'p_owner_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_document_id IS NULL THEN
    RAISE EXCEPTION 'p_document_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_upload_id IS NULL THEN
    RAISE EXCEPTION 'p_upload_id is required' USING ERRCODE = '22023';
  END IF;

  -- 1. Get Document & Check Idempotency
  SELECT
    d.id,
    COALESCE(d.owner_id, d.user_id) AS owner_id,
    d.status
  INTO v_doc
  FROM public.au_documents d
  WHERE d.id = p_document_id
    AND COALESCE(d.owner_id, d.user_id) = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'code', 'document_not_found',
      'message', 'Document not found for owner.'
    );
  END IF;

  -- If already finalized
  IF v_doc.status IN ('uploaded', 'processing', 'completed', 'done', 'indexed') THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'already_finalized', TRUE,
      'job_id', p_job_id,
      'document_id', p_document_id
    );
  END IF;

  -- 2. Quota Enforcement
  -- Get user tier
  SELECT LOWER(COALESCE(tier, 'free')) INTO v_tier FROM public.au_user_profiles WHERE user_id = p_owner_id;
  
  -- Get limits
  SELECT limits INTO v_limits FROM public.plan_limits WHERE plan = v_tier AND effective_from <= v_now ORDER BY effective_from DESC LIMIT 1;
  v_limits := COALESCE(v_limits, '{}'::jsonb);
  
  v_max_docs := COALESCE((v_limits->>'max_docs_total')::INT, 20);
  v_max_uploads_daily := COALESCE((v_limits->>'max_uploads_per_day')::INT, 3);
  v_max_storage_mb := COALESCE((v_limits->>'max_storage_mb')::INT, 1024);

  -- Calculate file size in MB
  v_file_mb := CEIL(p_file_size_bytes::numeric / 1048576.0);

  -- Get current usage (lock row for atomicity)
  INSERT INTO public.usage_counters (user_id, day, counters) VALUES (p_owner_id, current_date, '{}'::jsonb) ON CONFLICT (user_id, day) DO NOTHING;
  
  SELECT counters INTO v_usage_day FROM public.usage_counters WHERE user_id = p_owner_id AND day = current_date FOR UPDATE;
  
  -- Total active docs (count non-failed)
  SELECT COUNT(*) INTO v_current_docs FROM public.au_documents WHERE (owner_id = p_owner_id OR user_id = p_owner_id) AND status != 'failed';
  
  -- Daily uploads
  v_current_uploads_daily := COALESCE((v_usage_day->>'uploads_count')::INT, 0);
  
  -- Total storage
  SELECT COALESCE(SUM(CEIL(file_size_bytes::numeric / 1048576.0)), 0) INTO v_current_storage_mb 
  FROM public.au_documents WHERE (owner_id = p_owner_id OR user_id = p_owner_id) AND status != 'failed';

  -- Check Limits
  IF v_current_docs >= v_max_docs THEN
    RAISE EXCEPTION 'Quota exceeded: Max documents (%/% allowed)', v_current_docs, v_max_docs USING ERRCODE = '40200';
  END IF;
  
  IF v_current_uploads_daily >= v_max_uploads_daily THEN
    RAISE EXCEPTION 'Quota exceeded: Max daily uploads (%/% allowed)', v_current_uploads_daily, v_max_uploads_daily USING ERRCODE = '40200';
  END IF;
  
  IF (v_current_storage_mb + v_file_mb) > v_max_storage_mb THEN
    RAISE EXCEPTION 'Quota exceeded: Max storage (%MB/%MB allowed)', (v_current_storage_mb + v_file_mb), v_max_storage_mb USING ERRCODE = '40200';
  END IF;

  -- 3. Upsert Job (Preserving logic from previous migration)
  INSERT INTO public.au_worker_jobs (
    id,
    job_id,
    owner_id,
    correlation_id,
    document_id,
    upload_id,
    file_name,
    mime_type,
    file_size_bytes,
    bucket,
    object_path,
    status,
    priority,
    worker_group,
    metadata,
    created_at,
    updated_at
  )
  VALUES (
    gen_random_uuid(),
    p_job_id,
    p_owner_id,
    p_correlation_id,
    p_document_id,
    p_upload_id,
    p_file_name,
    p_mime_type,
    p_file_size_bytes,
    p_bucket,
    p_object_path,
    'queued',
    0,
    'vps-worker',
    v_metadata,
    now(),
    now()
  )
  ON CONFLICT ON CONSTRAINT au_worker_jobs_owner_upload_id_key
  DO UPDATE
    SET correlation_id = EXCLUDED.correlation_id,
        document_id = EXCLUDED.document_id,
        file_name = EXCLUDED.file_name,
        mime_type = EXCLUDED.mime_type,
        file_size_bytes = EXCLUDED.file_size_bytes,
        bucket = EXCLUDED.bucket,
        object_path = EXCLUDED.object_path,
        metadata = EXCLUDED.metadata,
        status = CASE
          WHEN public.au_worker_jobs.status IN ('completed', 'done') THEN public.au_worker_jobs.status
          ELSE 'queued'
        END,
        updated_at = now()
  RETURNING id INTO v_job_id;

  -- 4. Update Document
  UPDATE public.au_documents
  SET
    job_id = p_job_id,
    storage_path = p_object_path, -- Was p_object_path in previous logic? Yes.
    file_name = p_file_name, -- Also update file name if changed? Previous logic didn't explicitly update all fields but did update status.
                             -- Previous logic: 
                             -- UPDATE public.au_documents SET status = ... WHERE id = p_document_id;
                             -- It relied on `initiate` to set most fields.
                             -- But here we have p_object_path etc. It's safer to update them.
    status = 'uploaded',
    updated_at = v_now
  WHERE id = p_document_id;

  -- 5. Increment Counters
  v_usage_day := jsonb_set(v_usage_day, '{uploads_count}', to_jsonb(COALESCE((v_usage_day->>'uploads_count')::numeric, 0) + 1));
  v_usage_day := jsonb_set(v_usage_day, '{used_uploads}', to_jsonb(COALESCE((v_usage_day->>'used_uploads')::numeric, 0) + 1));
  v_usage_day := jsonb_set(v_usage_day, '{jobs_started}', to_jsonb(COALESCE((v_usage_day->>'jobs_started')::numeric, 0) + 1));
  v_usage_day := jsonb_set(v_usage_day, '{used_storage_mb}', to_jsonb(COALESCE((v_usage_day->>'used_storage_mb')::numeric, 0) + v_file_mb));
  v_usage_day := jsonb_set(v_usage_day, '{uploaded_mb}', to_jsonb(COALESCE((v_usage_day->>'uploaded_mb')::numeric, 0) + v_file_mb));
  
  UPDATE public.usage_counters SET counters = v_usage_day, updated_at = v_now WHERE user_id = p_owner_id AND day = current_date;
  
  RETURN jsonb_build_object(
    'ok', TRUE,
    'already_finalized', FALSE,
    'job_id', v_job_id,
    'document_id', p_document_id,
    'quota_consumed', TRUE
  );
END;
$$;

-- 2. Drop dead RPC
DROP FUNCTION IF EXISTS public.consume_document_upload_quota(uuid, uuid, text);
