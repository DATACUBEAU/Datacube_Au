BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.au_deletion_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  owner_id UUID NULL,
  file_path TEXT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_au_deletion_log_processed
  ON public.au_deletion_log (processed, deleted_at DESC);

CREATE INDEX IF NOT EXISTS idx_au_deletion_log_document
  ON public.au_deletion_log (document_id, deleted_at DESC);

CREATE OR REPLACE FUNCTION public.log_document_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.au_deletion_log (document_id, owner_id, file_path, deleted_at, processed, processed_at)
  VALUES (OLD.id, COALESCE(OLD.owner_id, OLD.user_id), OLD.file_path, now(), FALSE, NULL);

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_document_delete_log ON public.au_documents;

CREATE TRIGGER on_document_delete_log
AFTER DELETE ON public.au_documents
FOR EACH ROW
EXECUTE FUNCTION public.log_document_deletion();

CREATE INDEX IF NOT EXISTS idx_au_documents_expires_at
  ON public.au_documents (expires_at);

CREATE TABLE IF NOT EXISTS public.au_retention_runs (
  id BIGSERIAL PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('preview', 'execute')),
  trigger_source TEXT NOT NULL,
  initiated_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_au_retention_runs_started_at
  ON public.au_retention_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_au_retention_runs_status
  ON public.au_retention_runs (status, started_at DESC);

CREATE TABLE IF NOT EXISTS public.au_retention_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('plan_expiry', 'inactive_files', 'inactive_account')),
  target_type TEXT NOT NULL CHECK (target_type IN ('document', 'user')),
  target_id TEXT NOT NULL,
  owner_id UUID NULL,
  email_snapshot TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('eligible', 'in_progress', 'deleted', 'failed', 'skipped')),
  reason TEXT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  last_run_id BIGINT NULL REFERENCES public.au_retention_runs(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
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
  lease_key TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_au_runtime_leases_expires_at
  ON public.au_runtime_leases (expires_at);

DROP FUNCTION IF EXISTS public.try_claim_retention_lease(TEXT, TEXT, INTEGER);
CREATE OR REPLACE FUNCTION public.try_claim_retention_lease(
  p_lease_key TEXT,
  p_worker_id TEXT,
  p_ttl_seconds INTEGER DEFAULT 900
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease_key TEXT := NULLIF(trim(COALESCE(p_lease_key, '')), '');
  v_worker_id TEXT := NULLIF(trim(COALESCE(p_worker_id, '')), '');
  v_now TIMESTAMPTZ := now();
  v_expires_at TIMESTAMPTZ := now() + make_interval(secs => GREATEST(COALESCE(p_ttl_seconds, 0), 30));
  v_claimed BOOLEAN := FALSE;
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

  RETURN COALESCE(v_claimed, FALSE);
END;
$$;

DROP FUNCTION IF EXISTS public.release_retention_lease(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.release_retention_lease(
  p_lease_key TEXT,
  p_worker_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lease_key TEXT := NULLIF(trim(COALESCE(p_lease_key, '')), '');
  v_worker_id TEXT := NULLIF(trim(COALESCE(p_worker_id, '')), '');
BEGIN
  IF v_lease_key IS NULL OR v_worker_id IS NULL THEN
    RETURN FALSE;
  END IF;

  DELETE FROM public.au_runtime_leases
  WHERE lease_key = v_lease_key
    AND worker_id = v_worker_id;

  RETURN FOUND;
END;
$$;

ALTER TABLE public.au_deletion_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_retention_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_retention_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_runtime_leases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "au_deletion_log_service_role" ON public.au_deletion_log;
CREATE POLICY "au_deletion_log_service_role"
ON public.au_deletion_log
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_retention_runs_service_role" ON public.au_retention_runs;
CREATE POLICY "au_retention_runs_service_role"
ON public.au_retention_runs
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_retention_actions_service_role" ON public.au_retention_actions;
CREATE POLICY "au_retention_actions_service_role"
ON public.au_retention_actions
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_runtime_leases_service_role" ON public.au_runtime_leases;
CREATE POLICY "au_runtime_leases_service_role"
ON public.au_runtime_leases
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

REVOKE ALL ON FUNCTION public.try_claim_retention_lease(TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_retention_lease(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_claim_retention_lease(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_retention_lease(TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
