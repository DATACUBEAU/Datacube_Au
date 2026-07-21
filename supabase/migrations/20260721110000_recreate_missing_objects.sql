BEGIN;

-- Recreating tables from 20260216000000_hybrid_memory.sql
create table if not exists memory_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('global', 'doc')),
  doc_id text,
  doc_key text,
  summary text,
  pinned_facts jsonb default '[]'::jsonb,
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  
  -- constraint: doc_id is required if scope is 'doc'
  constraint doc_id_required_for_doc_scope check (
    (scope = 'doc' and doc_id is not null) or (scope = 'global')
  ),
  
  -- unique constraint to ensure one summary per scope/doc per user
  constraint unique_memory_summary unique (user_id, scope, doc_id)
);

-- Enable RLS
alter table memory_summaries enable row level security;

-- Policies
create policy "Users can read own memory summaries"
  on memory_summaries for select
  using (auth.uid() = user_id);

create policy "Users can insert/update own memory summaries"
  on memory_summaries for all
  using (auth.uid() = user_id);

-- Create admin_access_logs table for brute force protection
create table if not exists admin_access_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  ip_address text,
  attempt_count int default 1,
  locked_until timestamptz,
  last_attempt_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Index for fast lookup
create index idx_admin_access_logs_user_ip on admin_access_logs(user_id, ip_address);

-- Enable RLS
alter table admin_access_logs enable row level security;

-- Policy: only service role can really manage this, but we'll add a read policy for checking status
create policy "Service role full access"
  on admin_access_logs for all
  using ( auth.role() = 'service_role' );

-- Recreating finalize_document_upload from 20260307200000_au_documents_file_size_bytes.sql
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

-- Recreating admin_set_user_plan_override from 20260630120000_admin_plan_assignment_overrides.sql
CREATE OR REPLACE FUNCTION public.admin_set_user_plan_override(
  p_actor_user_id UUID,
  p_actor_email TEXT,
  p_target_user_id UUID,
  p_target_plan TEXT,
  p_previous_effective_plan TEXT DEFAULT NULL,
  p_change_type TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_target_plan TEXT := LOWER(NULLIF(TRIM(p_target_plan), ''));
  v_previous_override TEXT := NULL;
  v_exists BOOLEAN := FALSE;
BEGIN
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'missing_actor_or_target' USING ERRCODE = '22023';
  END IF;

  IF v_target_plan = 'pro' THEN
    v_target_plan := 'pro_monthly';
  END IF;

  IF v_target_plan NOT IN ('free', 'pro_monthly', 'premium') THEN
    RAISE EXCEPTION 'invalid_target_plan' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_user_id)
  INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'target_user_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT admin_override_plan
  INTO v_previous_override
  FROM public.au_user_entitlements
  WHERE user_id = p_target_user_id
  FOR UPDATE;

  INSERT INTO public.au_user_entitlements (
    user_id,
    plan,
    source,
    expires_at,
    admin_override_plan,
    metadata,
    updated_at
  )
  VALUES (
    p_target_user_id,
    'free',
    'none',
    NULL,
    v_target_plan,
    jsonb_build_object(
      'admin_plan_actor_id', p_actor_user_id,
      'admin_plan_actor_email', p_actor_email,
      'admin_plan_updated_at', v_now,
      'admin_plan_reason', COALESCE(NULLIF(TRIM(p_reason), ''), 'admin_plan_assignment'),
      'admin_plan_request_id', p_request_id
    ),
    v_now
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
    admin_override_plan = EXCLUDED.admin_override_plan,
    metadata = COALESCE(public.au_user_entitlements.metadata, '{}'::jsonb)
      || EXCLUDED.metadata
      || jsonb_build_object('previous_admin_override_plan', v_previous_override),
    updated_at = v_now;

  INSERT INTO public.admin_entitlement_override_audit (
    user_id,
    actor_user_id,
    actor_email,
    previous_override_plan,
    next_override_plan,
    reason,
    metadata,
    created_at
  )
  VALUES (
    p_target_user_id,
    p_actor_user_id,
    p_actor_email,
    v_previous_override,
    v_target_plan,
    COALESCE(NULLIF(TRIM(p_reason), ''), 'admin_plan_assignment'),
    jsonb_build_object(
      'previous_effective_plan', p_previous_effective_plan,
      'next_effective_plan', v_target_plan,
      'change_type', p_change_type,
      'request_id', p_request_id,
      'billing_records_preserved', TRUE
    ),
    v_now
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'user_id', p_target_user_id,
    'previous_override_plan', v_previous_override,
    'next_override_plan', v_target_plan,
    'changed', COALESCE(v_previous_override, '') <> v_target_plan,
    'billing_records_preserved', TRUE,
    'updated_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_plan_override(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_plan_override(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMIT;
