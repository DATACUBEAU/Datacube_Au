-- Upload finalize hardening:
-- - idempotent finalize keyed by upload_id
-- - transactional DB finalize RPC
-- - upload audit table for correlation_id tracing
-- - attachment expiry inheritance from parent textbook

BEGIN;

ALTER TABLE public.au_worker_jobs
  ADD COLUMN IF NOT EXISTS upload_id uuid,
  ADD COLUMN IF NOT EXISTS correlation_id text;

UPDATE public.au_worker_jobs
SET upload_id = id
WHERE upload_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'au_worker_jobs_owner_upload_id_key'
      AND conrelid = 'public.au_worker_jobs'::regclass
  ) THEN
    ALTER TABLE public.au_worker_jobs
      ADD CONSTRAINT au_worker_jobs_owner_upload_id_key
      UNIQUE (owner_id, upload_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_au_worker_jobs_upload_id
  ON public.au_worker_jobs (upload_id);

ALTER TABLE public.au_documents
  ADD COLUMN IF NOT EXISTS parent_document_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'au_documents_parent_document_id_fkey'
      AND conrelid = 'public.au_documents'::regclass
  ) THEN
    ALTER TABLE public.au_documents
      ADD CONSTRAINT au_documents_parent_document_id_fkey
      FOREIGN KEY (parent_document_id)
      REFERENCES public.au_documents(id)
      ON DELETE CASCADE;
  END IF;
END $$;

UPDATE public.au_documents
SET
  parent_document_id = COALESCE(parent_document_id, parent_id),
  parent_id = COALESCE(parent_id, parent_document_id)
WHERE parent_document_id IS NULL OR parent_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_au_documents_parent_document_id
  ON public.au_documents (parent_document_id);

CREATE TABLE IF NOT EXISTS public.au_upload_audit_log (
  id bigserial PRIMARY KEY,
  correlation_id text NOT NULL,
  upload_id uuid,
  document_id uuid,
  owner_id uuid,
  action text NOT NULL,
  status text NOT NULL,
  error_code text,
  error_message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_au_upload_audit_log_corr
  ON public.au_upload_audit_log (correlation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_au_upload_audit_log_upload
  ON public.au_upload_audit_log (upload_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.inherit_attachment_expiry_from_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_parent_id uuid;
  v_parent_expires_at timestamptz;
BEGIN
  v_parent_id := COALESCE(NEW.parent_document_id, NEW.parent_id);

  IF v_parent_id IS NULL THEN
    NEW.parent_document_id := NULL;
    RETURN NEW;
  END IF;

  IF NEW.id IS NOT NULL AND NEW.id = v_parent_id THEN
    RAISE EXCEPTION 'parent_document_cannot_reference_self'
      USING ERRCODE = '22023';
  END IF;

  SELECT expires_at
  INTO v_parent_expires_at
  FROM public.au_documents
  WHERE id = v_parent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'parent_document_not_found'
      USING ERRCODE = '22023';
  END IF;

  IF v_parent_expires_at IS NULL THEN
    RAISE EXCEPTION 'parent_document_missing_expiry'
      USING ERRCODE = '22023';
  END IF;

  IF v_parent_expires_at <= now() THEN
    RAISE EXCEPTION 'parent_document_expired'
      USING ERRCODE = '22023';
  END IF;

  NEW.parent_document_id := v_parent_id;
  NEW.parent_id := v_parent_id;
  NEW.expires_at := v_parent_expires_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_au_documents_inherit_parent_expiry ON public.au_documents;

CREATE TRIGGER tr_au_documents_inherit_parent_expiry
BEFORE INSERT OR UPDATE OF parent_id, parent_document_id
ON public.au_documents
FOR EACH ROW
EXECUTE FUNCTION public.inherit_attachment_expiry_from_parent();

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
    END
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
    GREATEST(COALESCE(p_file_size_bytes, 0), 0),
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
  END
  WHERE id = p_document_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'already_finalized', FALSE,
    'job_id', v_job_id,
    'document_id', p_document_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_document_upload(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  jsonb,
  text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.finalize_document_upload(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  jsonb,
  text
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
