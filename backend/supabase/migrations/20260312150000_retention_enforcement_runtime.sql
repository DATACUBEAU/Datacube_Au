BEGIN;

ALTER TABLE IF EXISTS public.au_documents
  ADD COLUMN IF NOT EXISTS source_deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_cleanup_result TEXT;

UPDATE public.au_documents
SET source_cleanup_result = 'deleted',
    source_deleted_at = COALESCE(source_deleted_at, storage_deleted_at)
WHERE storage_deleted_at IS NOT NULL
  AND source_cleanup_result IS NULL;

CREATE TABLE IF NOT EXISTS public.au_retention_runs (
  id BIGSERIAL PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('preview', 'execute')),
  trigger_source TEXT NOT NULL,
  initiated_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_au_retention_runs_started_at
  ON public.au_retention_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS public.au_retention_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('plan_expiry', 'inactive_files', 'inactive_account')),
  target_type TEXT NOT NULL CHECK (target_type IN ('document', 'user')),
  target_id TEXT NOT NULL,
  owner_id UUID NULL,
  email_snapshot TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('eligible', 'in_progress', 'deleted', 'failed', 'skipped')),
  reason TEXT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  last_run_id BIGINT NULL REFERENCES public.au_retention_runs(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_au_retention_actions_target UNIQUE (scope, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_au_retention_actions_owner
  ON public.au_retention_actions (owner_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_au_retention_actions_status
  ON public.au_retention_actions (status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.au_retention_leases (
  lease_key TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE OR REPLACE FUNCTION public.touch_au_retention_action_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_au_retention_action_updated_at ON public.au_retention_actions;
CREATE TRIGGER trg_touch_au_retention_action_updated_at
BEFORE UPDATE ON public.au_retention_actions
FOR EACH ROW
EXECUTE FUNCTION public.touch_au_retention_action_updated_at();

ALTER TABLE public.au_retention_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_retention_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_retention_leases ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.try_claim_retention_lease(
  p_lease_key TEXT,
  p_worker_id TEXT,
  p_ttl_seconds INTEGER DEFAULT 900
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_claimed BOOLEAN := FALSE;
BEGIN
  INSERT INTO public.au_retention_leases (
    lease_key,
    worker_id,
    claimed_at,
    heartbeat_at,
    expires_at
  )
  VALUES (
    p_lease_key,
    p_worker_id,
    v_now,
    v_now,
    v_now + make_interval(secs => GREATEST(COALESCE(p_ttl_seconds, 900), 30))
  )
  ON CONFLICT (lease_key) DO UPDATE
  SET
    worker_id = EXCLUDED.worker_id,
    claimed_at = v_now,
    heartbeat_at = v_now,
    expires_at = v_now + make_interval(secs => GREATEST(COALESCE(p_ttl_seconds, 900), 30))
  WHERE public.au_retention_leases.expires_at <= v_now
     OR public.au_retention_leases.worker_id = p_worker_id
  RETURNING TRUE INTO v_claimed;

  RETURN jsonb_build_object(
    'claimed', COALESCE(v_claimed, FALSE),
    'lease_key', p_lease_key,
    'worker_id', p_worker_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_retention_lease(
  p_lease_key TEXT,
  p_worker_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_released BOOLEAN := FALSE;
BEGIN
  DELETE FROM public.au_retention_leases
  WHERE lease_key = p_lease_key
    AND (worker_id = p_worker_id OR expires_at <= now())
  RETURNING TRUE INTO v_released;

  RETURN jsonb_build_object(
    'released', COALESCE(v_released, FALSE),
    'lease_key', p_lease_key,
    'worker_id', p_worker_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_retention_data(p_dry_run BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'ok', true,
    'deprecated', true,
    'dry_run', COALESCE(p_dry_run, false),
    'reason', 'retention_cleanup_moved_to_service_runner',
    'runner', '/api/cron/retention'
  );
END;
$$;

REVOKE ALL ON TABLE public.au_retention_runs FROM PUBLIC;
REVOKE ALL ON TABLE public.au_retention_actions FROM PUBLIC;
REVOKE ALL ON TABLE public.au_retention_leases FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_claim_retention_lease(TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_retention_lease(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_retention_data(BOOLEAN) FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.au_retention_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.au_retention_actions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.au_retention_leases TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.au_retention_runs_id_seq TO service_role;
GRANT EXECUTE ON FUNCTION public.try_claim_retention_lease(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_retention_lease(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_retention_data(BOOLEAN) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
