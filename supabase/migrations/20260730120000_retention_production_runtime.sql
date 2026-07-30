BEGIN;

ALTER TABLE public.au_documents
  ADD COLUMN IF NOT EXISTS retention_granted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS retention_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS retention_tier text NULL,
  ADD COLUMN IF NOT EXISTS retention_days integer NULL,
  ADD COLUMN IF NOT EXISTS retention_policy_version text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'au_documents_retention_tier_check'
      AND conrelid = 'public.au_documents'::regclass
  ) THEN
    ALTER TABLE public.au_documents
      ADD CONSTRAINT au_documents_retention_tier_check
      CHECK (retention_tier IS NULL OR retention_tier IN ('free', 'promo', 'pro'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'au_documents_retention_days_check'
      AND conrelid = 'public.au_documents'::regclass
  ) THEN
    ALTER TABLE public.au_documents
      ADD CONSTRAINT au_documents_retention_days_check
      CHECK (retention_days IS NULL OR retention_days > 0)
      NOT VALID;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_au_documents_expires_at
  ON public.au_documents (expires_at);

CREATE INDEX IF NOT EXISTS idx_au_documents_retention_deadline
  ON public.au_documents ((COALESCE(retention_expires_at, expires_at)))
  WHERE COALESCE(retention_expires_at, expires_at) IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_au_documents_owner_retention_deadline
  ON public.au_documents (owner_id, (COALESCE(retention_expires_at, expires_at)))
  WHERE owner_id IS NOT NULL
    AND COALESCE(retention_expires_at, expires_at) IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_au_documents_user_retention_deadline
  ON public.au_documents (user_id, (COALESCE(retention_expires_at, expires_at)))
  WHERE user_id IS NOT NULL
    AND COALESCE(retention_expires_at, expires_at) IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_au_user_profiles_last_activity_at
  ON public.au_user_profiles (last_activity_at);

CREATE TABLE IF NOT EXISTS public.au_user_activity (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  user_agent text NULL,
  is_pwa boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.au_user_activity
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS user_agent text NULL,
  ADD COLUMN IF NOT EXISTS is_pwa boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_au_user_activity_last_active_at
  ON public.au_user_activity (last_active_at);

DO $$
BEGIN
  IF to_regclass('public.au_document_embeddings') IS NOT NULL THEN
    ALTER TABLE public.au_document_embeddings
      ADD COLUMN IF NOT EXISTS owner_id uuid NULL,
      ADD COLUMN IF NOT EXISTS user_id uuid NULL;

    UPDATE public.au_document_embeddings embeddings
    SET
      owner_id = COALESCE(embeddings.owner_id, documents.owner_id, documents.user_id),
      user_id = COALESCE(embeddings.user_id, documents.user_id, documents.owner_id)
    FROM public.au_documents documents
    WHERE embeddings.document_id = documents.id
      AND (embeddings.owner_id IS NULL OR embeddings.user_id IS NULL);

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_au_document_embeddings_owner_document ON public.au_document_embeddings (owner_id, document_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_au_document_embeddings_user_document ON public.au_document_embeddings (user_id, document_id)';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.au_deletion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  owner_id uuid NULL,
  file_path text NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  processed boolean NOT NULL DEFAULT false,
  processed_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_au_deletion_log_processed
  ON public.au_deletion_log (processed, deleted_at DESC);

CREATE INDEX IF NOT EXISTS idx_au_deletion_log_document
  ON public.au_deletion_log (document_id, deleted_at DESC);

CREATE OR REPLACE FUNCTION public.log_document_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.au_deletion_log (document_id, owner_id, file_path, deleted_at, processed, processed_at)
  VALUES (OLD.id, COALESCE(OLD.owner_id, OLD.user_id), NULL, now(), false, NULL);

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_document_delete_log ON public.au_documents;

CREATE TRIGGER on_document_delete_log
AFTER DELETE ON public.au_documents
FOR EACH ROW
EXECUTE FUNCTION public.log_document_deletion();

CREATE OR REPLACE FUNCTION public.inherit_attachment_expiry_from_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_row record;
  parent_doc_id uuid;
BEGIN
  parent_doc_id := COALESCE(NEW.parent_document_id, NEW.parent_id);

  IF parent_doc_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    expires_at,
    retention_granted_at,
    retention_expires_at,
    retention_tier,
    retention_days,
    retention_policy_version
  INTO parent_row
  FROM public.au_documents
  WHERE id = parent_doc_id
    AND COALESCE(owner_id, user_id) = COALESCE(NEW.owner_id, NEW.user_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'parent_document_not_found' USING ERRCODE = '22023';
  END IF;

  IF parent_row.expires_at IS NULL THEN
    RAISE EXCEPTION 'parent_document_missing_expiry' USING ERRCODE = '22023';
  END IF;

  NEW.expires_at := COALESCE(NEW.expires_at, parent_row.expires_at);
  NEW.retention_granted_at := COALESCE(NEW.retention_granted_at, parent_row.retention_granted_at);
  NEW.retention_expires_at := COALESCE(NEW.retention_expires_at, parent_row.retention_expires_at, parent_row.expires_at);
  NEW.retention_tier := COALESCE(NEW.retention_tier, parent_row.retention_tier);
  NEW.retention_days := COALESCE(NEW.retention_days, parent_row.retention_days);
  NEW.retention_policy_version := COALESCE(NEW.retention_policy_version, parent_row.retention_policy_version);

  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.au_retention_runs (
  id bigserial PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('preview', 'execute')),
  trigger_source text NOT NULL,
  initiated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text NULL
);

CREATE INDEX IF NOT EXISTS idx_au_retention_runs_started_at
  ON public.au_retention_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_au_retention_runs_status
  ON public.au_retention_runs (status, started_at DESC);

CREATE TABLE IF NOT EXISTS public.au_retention_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('plan_expiry', 'inactive_files', 'inactive_account')),
  target_type text NOT NULL CHECK (target_type IN ('document', 'user')),
  target_id text NOT NULL,
  owner_id uuid NULL,
  email_snapshot text NULL,
  status text NOT NULL CHECK (status IN ('eligible', 'in_progress', 'deleted', 'failed', 'skipped')),
  reason text NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  last_error text NULL,
  last_run_id bigint NULL REFERENCES public.au_retention_runs(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_au_retention_actions_scope_target
  ON public.au_retention_actions (scope, target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_au_retention_actions_owner
  ON public.au_retention_actions (owner_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_au_retention_actions_status
  ON public.au_retention_actions (status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_au_retention_actions_target
  ON public.au_retention_actions (target_type, target_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.au_runtime_leases (
  lease_key text PRIMARY KEY,
  worker_id text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_au_runtime_leases_expires_at
  ON public.au_runtime_leases (expires_at);

CREATE OR REPLACE FUNCTION public.try_claim_retention_lease(
  p_lease_key text,
  p_worker_id text,
  p_ttl_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease_key text := NULLIF(trim(COALESCE(p_lease_key, '')), '');
  v_worker_id text := NULLIF(trim(COALESCE(p_worker_id, '')), '');
  v_now timestamptz := now();
  v_expires_at timestamptz := now() + make_interval(secs => GREATEST(COALESCE(p_ttl_seconds, 0), 30));
  v_claimed boolean := false;
BEGIN
  IF v_lease_key IS NULL THEN
    RAISE EXCEPTION 'lease_key_required' USING ERRCODE = '22023';
  END IF;

  IF v_worker_id IS NULL THEN
    RAISE EXCEPTION 'worker_id_required' USING ERRCODE = '22023';
  END IF;

  WITH claimed AS (
    INSERT INTO public.au_runtime_leases (lease_key, worker_id, acquired_at, updated_at, expires_at)
    VALUES (v_lease_key, v_worker_id, v_now, v_now, v_expires_at)
    ON CONFLICT (lease_key) DO UPDATE
      SET worker_id = EXCLUDED.worker_id,
          acquired_at = EXCLUDED.acquired_at,
          updated_at = EXCLUDED.updated_at,
          expires_at = EXCLUDED.expires_at
    WHERE public.au_runtime_leases.expires_at <= v_now
       OR public.au_runtime_leases.worker_id = EXCLUDED.worker_id
    RETURNING 1
  )
  SELECT EXISTS(SELECT 1 FROM claimed) INTO v_claimed;

  RETURN COALESCE(v_claimed, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_retention_lease(
  p_lease_key text,
  p_worker_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease_key text := NULLIF(trim(COALESCE(p_lease_key, '')), '');
  v_worker_id text := NULLIF(trim(COALESCE(p_worker_id, '')), '');
BEGIN
  IF v_lease_key IS NULL OR v_worker_id IS NULL THEN
    RETURN false;
  END IF;

  DELETE FROM public.au_runtime_leases
  WHERE lease_key = v_lease_key
    AND worker_id = v_worker_id;

  RETURN FOUND;
END;
$$;

ALTER TABLE public.au_deletion_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_user_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_retention_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_retention_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_runtime_leases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "au_deletion_log_service_role" ON public.au_deletion_log;
CREATE POLICY "au_deletion_log_service_role"
ON public.au_deletion_log
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "au_user_activity_service_role" ON public.au_user_activity;
CREATE POLICY "au_user_activity_service_role"
ON public.au_user_activity
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "au_retention_runs_service_role" ON public.au_retention_runs;
CREATE POLICY "au_retention_runs_service_role"
ON public.au_retention_runs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "au_retention_actions_service_role" ON public.au_retention_actions;
CREATE POLICY "au_retention_actions_service_role"
ON public.au_retention_actions
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "au_runtime_leases_service_role" ON public.au_runtime_leases;
CREATE POLICY "au_runtime_leases_service_role"
ON public.au_runtime_leases
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

REVOKE ALL ON TABLE public.au_deletion_log FROM anon, authenticated;
REVOKE ALL ON TABLE public.au_user_activity FROM anon, authenticated;
REVOKE ALL ON TABLE public.au_retention_runs FROM anon, authenticated;
REVOKE ALL ON TABLE public.au_retention_actions FROM anon, authenticated;
REVOKE ALL ON TABLE public.au_runtime_leases FROM anon, authenticated;

GRANT ALL ON TABLE public.au_deletion_log TO service_role;
GRANT ALL ON TABLE public.au_user_activity TO service_role;
GRANT ALL ON TABLE public.au_retention_runs TO service_role;
GRANT ALL ON TABLE public.au_retention_actions TO service_role;
GRANT ALL ON TABLE public.au_runtime_leases TO service_role;

DO $$
BEGIN
  IF to_regclass('public.au_retention_runs_id_seq') IS NOT NULL THEN
    GRANT USAGE, SELECT ON SEQUENCE public.au_retention_runs_id_seq TO service_role;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.try_claim_retention_lease(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_retention_lease(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_document_deletion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inherit_attachment_expiry_from_parent() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_claim_retention_lease(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_retention_lease(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_document_deletion() TO service_role;
GRANT EXECUTE ON FUNCTION public.inherit_attachment_expiry_from_parent() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
