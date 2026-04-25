BEGIN;

ALTER TABLE public.au_documents
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;

WITH latest_job_sizes AS (
  SELECT DISTINCT ON (j.document_id)
    j.document_id,
    CASE
      WHEN j.file_size_bytes IS NULL THEN NULL
      ELSE GREATEST(j.file_size_bytes, 0)
    END AS normalized_file_size_bytes
  FROM public.au_worker_jobs j
  WHERE j.document_id IS NOT NULL
  ORDER BY j.document_id, j.updated_at DESC NULLS LAST, j.created_at DESC NULLS LAST, j.id DESC
)
UPDATE public.au_documents d
SET file_size_bytes = latest_job_sizes.normalized_file_size_bytes
FROM latest_job_sizes
WHERE d.id = latest_job_sizes.document_id
  AND d.file_size_bytes IS NULL;

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
  v_existing record;
  v_job_id uuid;
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
  v_normalized_file_size bigint := CASE
    WHEN p_file_size_bytes IS NULL THEN NULL
    ELSE GREATEST(p_file_size_bytes, 0)
  END;
BEGIN
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'p_owner_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_document_id IS NULL THEN
    RAISE EXCEPTION 'p_document_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_upload_id IS NULL THEN
    RAISE EXCEPTION 'p_upload_id is required' USING ERRCODE = '22023';
  END IF;

  SELECT
    d.id,
    COALESCE(d.owner_id, d.user_id) AS owner_id,
    d.file_path,
    d.file_name,
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

  SELECT id, document_id, status
  INTO v_existing
  FROM public.au_worker_jobs
  WHERE owner_id = p_owner_id
    AND upload_id = p_upload_id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.au_documents
    SET status = CASE
      WHEN status IN ('processing', 'completed', 'done', 'indexed') THEN status
      ELSE 'uploaded'
    END,
        file_name = COALESCE(NULLIF(trim(p_file_name), ''), file_name),
        file_path = COALESCE(NULLIF(trim(p_object_path), ''), file_path),
        file_size_bytes = COALESCE(v_normalized_file_size, file_size_bytes)
    WHERE id = p_document_id;

    RETURN jsonb_build_object(
      'ok', TRUE,
      'already_finalized', TRUE,
      'job_id', v_existing.id,
      'document_id', v_existing.document_id
    );
  END IF;

  v_job_id := COALESCE(p_job_id, gen_random_uuid());

  INSERT INTO public.au_worker_jobs (
    id,
    upload_id,
    correlation_id,
    document_id,
    user_id,
    owner_id,
    file_name,
    mime_type,
    file_size_bytes,
    bucket,
    object_path,
    status,
    progress,
    worker_id,
    metadata,
    created_at,
    updated_at
  )
  VALUES (
    v_job_id,
    p_upload_id,
    p_correlation_id,
    p_document_id,
    p_owner_id,
    p_owner_id,
    COALESCE(NULLIF(trim(p_file_name), ''), v_doc.file_name),
    NULLIF(trim(p_mime_type), ''),
    COALESCE(v_normalized_file_size, 0),
    COALESCE(NULLIF(trim(p_bucket), ''), 'documents'),
    COALESCE(NULLIF(trim(p_object_path), ''), v_doc.file_path),
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

  UPDATE public.au_documents
  SET status = CASE
    WHEN status IN ('processing', 'completed', 'done', 'indexed') THEN status
    ELSE 'uploaded'
  END,
      file_name = COALESCE(NULLIF(trim(p_file_name), ''), file_name),
      file_path = COALESCE(NULLIF(trim(p_object_path), ''), file_path),
      file_size_bytes = COALESCE(v_normalized_file_size, file_size_bytes)
  WHERE id = p_document_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'already_finalized', FALSE,
    'job_id', v_job_id,
    'document_id', p_document_id
  );
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
