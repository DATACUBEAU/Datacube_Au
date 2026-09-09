-- Linearize admin usage corrections against ordinary metered usage.
--
-- Admin set/reset operations are target-based. The adjustment-ledger guard added in
-- 20260827215500 prevents admin-vs-admin stale writes, but ordinary product usage can
-- still advance the canonical counters between the API snapshot and the correction.
-- A monotonic per-user mutation version closes that gap without creating another usage
-- source of truth: counter tables remain authoritative and this table is only a lock/
-- version primitive. Triggers bump it in the same transaction as every counter change.

BEGIN;

CREATE TABLE IF NOT EXISTS public.au_usage_mutation_versions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.au_usage_mutation_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.au_usage_mutation_versions FROM PUBLIC;
REVOKE ALL ON TABLE public.au_usage_mutation_versions FROM anon, authenticated;
GRANT ALL ON TABLE public.au_usage_mutation_versions TO service_role;

DROP POLICY IF EXISTS "service role can manage usage mutation versions" ON public.au_usage_mutation_versions;
CREATE POLICY "service role can manage usage mutation versions"
  ON public.au_usage_mutation_versions
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

CREATE OR REPLACE FUNCTION public.bump_usage_mutation_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_user_id := OLD.user_id;
  ELSE
    v_user_id := NEW.user_id;
  END IF;

  IF v_user_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO public.au_usage_mutation_versions (user_id, version, updated_at)
  VALUES (v_user_id, 1, now())
  ON CONFLICT (user_id) DO UPDATE
  SET version = public.au_usage_mutation_versions.version + 1,
      updated_at = now();

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS usage_counters_bump_mutation_version ON public.usage_counters;
CREATE TRIGGER usage_counters_bump_mutation_version
AFTER INSERT OR UPDATE OR DELETE ON public.usage_counters
FOR EACH ROW EXECUTE FUNCTION public.bump_usage_mutation_version();

DROP TRIGGER IF EXISTS usage_totals_bump_mutation_version ON public.usage_totals;
CREATE TRIGGER usage_totals_bump_mutation_version
AFTER INSERT OR UPDATE OR DELETE ON public.usage_totals
FOR EACH ROW EXECUTE FUNCTION public.bump_usage_mutation_version();

CREATE OR REPLACE FUNCTION public.get_usage_mutation_version(
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_version BIGINT := 0;
BEGIN
  IF p_user_id IS NULL THEN
    p_user_id := v_requester;
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_role <> 'service_role' THEN
    IF v_requester IS NULL OR (v_requester <> p_user_id AND NOT public.is_conex_admin(v_requester)) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT version
  INTO v_version
  FROM public.au_usage_mutation_versions
  WHERE user_id = p_user_id;

  RETURN COALESCE(v_version, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_usage_mutation_version(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_usage_mutation_version(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_usage_mutation_version(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_adjust_usage_versioned(
  p_actor_user_id UUID,
  p_actor_email TEXT,
  p_target_user_id UUID,
  p_metric_key TEXT,
  p_delta NUMERIC,
  p_action TEXT,
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL,
  p_expected_adjustment_total NUMERIC DEFAULT 0,
  p_expected_usage_version BIGINT DEFAULT 0,
  p_context JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_version BIGINT := 0;
BEGIN
  IF p_target_user_id IS NULL OR p_expected_usage_version IS NULL OR p_expected_usage_version < 0 THEN
    RAISE EXCEPTION 'invalid_usage_version' USING ERRCODE = '22023';
  END IF;

  -- Creating/locking this row gives admin corrections a linearization point with the
  -- counter triggers. If live usage is already mutating, this waits for that transaction
  -- and then observes the incremented version; if admin wins first, later usage is
  -- correctly ordered after the correction.
  INSERT INTO public.au_usage_mutation_versions (user_id, version, updated_at)
  VALUES (p_target_user_id, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT version
  INTO v_version
  FROM public.au_usage_mutation_versions
  WHERE user_id = p_target_user_id
  FOR UPDATE;

  IF COALESCE(v_version, 0) <> p_expected_usage_version THEN
    RAISE EXCEPTION 'usage_mutation_conflict'
      USING ERRCODE = '40001',
            DETAIL = 'Metered usage changed after it was loaded. Refresh and retry the operation.';
  END IF;

  RETURN public.admin_adjust_usage_checked(
    p_actor_user_id,
    p_actor_email,
    p_target_user_id,
    p_metric_key,
    p_delta,
    p_action,
    p_window_start,
    p_window_end,
    p_reason,
    p_request_id,
    p_expected_adjustment_total,
    p_context
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_adjust_usage_batch_versioned(
  p_actor_user_id UUID,
  p_actor_email TEXT,
  p_target_user_id UUID,
  p_reason TEXT,
  p_expected_usage_version BIGINT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_version BIGINT := 0;
BEGIN
  IF p_target_user_id IS NULL OR p_expected_usage_version IS NULL OR p_expected_usage_version < 0 THEN
    RAISE EXCEPTION 'invalid_usage_version' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'usage_adjustment_batch_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.au_usage_mutation_versions (user_id, version, updated_at)
  VALUES (p_target_user_id, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT version
  INTO v_version
  FROM public.au_usage_mutation_versions
  WHERE user_id = p_target_user_id
  FOR UPDATE;

  IF COALESCE(v_version, 0) <> p_expected_usage_version THEN
    RAISE EXCEPTION 'usage_mutation_conflict'
      USING ERRCODE = '40001',
            DETAIL = 'Metered usage changed after it was loaded. Refresh and retry the operation.';
  END IF;

  -- The existing checked batch remains the single transactional implementation for
  -- adjustment-ledger validation and reset-all atomicity. The version row stays locked
  -- until this transaction completes, so ordinary counter mutations cannot interleave.
  RETURN public.admin_adjust_usage_batch_checked(
    p_actor_user_id,
    p_actor_email,
    p_target_user_id,
    p_reason,
    p_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
