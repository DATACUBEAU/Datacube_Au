-- Bind reset-all retries to one durable root request so the same logical
-- operation cannot acquire effects for metrics that become adjustable later.
-- The receipt is append-only audit/idempotency state, not a usage counter.

BEGIN;

CREATE TABLE IF NOT EXISTS public.au_usage_admin_batch_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action = 'reset_all'),
  root_request_id TEXT NOT NULL CHECK (length(trim(root_request_id)) BETWEEN 8 AND 200),
  actor_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  items JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (user_id, action, root_request_id)
);

CREATE INDEX IF NOT EXISTS idx_au_usage_admin_batch_receipts_user_time
  ON public.au_usage_admin_batch_receipts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_au_usage_admin_batch_receipts_actor_time
  ON public.au_usage_admin_batch_receipts (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

ALTER TABLE public.au_usage_admin_batch_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.au_usage_admin_batch_receipts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.au_usage_admin_batch_receipts TO service_role;

CREATE OR REPLACE FUNCTION public.admin_adjust_usage_reset_all_versioned(
  p_actor_user_id UUID,
  p_actor_email TEXT,
  p_target_user_id UUID,
  p_reason TEXT,
  p_root_request_id TEXT,
  p_expected_usage_version BIGINT,
  p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_reason TEXT := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  v_root_request_id TEXT := NULLIF(TRIM(COALESCE(p_root_request_id, '')), '');
  v_actor_email TEXT := NULL;
  v_existing public.au_usage_admin_batch_receipts%ROWTYPE;
  v_inserted public.au_usage_admin_batch_receipts%ROWTYPE;
  v_batch_result JSONB := NULL;
BEGIN
  -- Authenticate before allowing an untrusted caller to hold accounting locks.
  IF v_role <> 'service_role' THEN
    IF v_requester IS NULL
      OR v_requester <> p_actor_user_id
      OR NOT public.is_conex_admin(v_requester)
    THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_usage_adjustment' USING ERRCODE = '22023';
  END IF;
  IF v_root_request_id IS NULL OR length(v_root_request_id) < 8 OR length(v_root_request_id) > 200 THEN
    RAISE EXCEPTION 'invalid_usage_adjustment_request_id' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'invalid_usage_adjustment_reason' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_usage_adjustment_batch' USING ERRCODE = '22023';
  END IF;

  -- Match the canonical accounting boundary before any receipt or child write.
  -- This also makes concurrent first-use calls for the same root request linear.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(concat_ws('|', 'usage_accounting_user', p_target_user_id::TEXT), 0)
  );

  SELECT *
  INTO v_existing
  FROM public.au_usage_admin_batch_receipts
  WHERE user_id = p_target_user_id
    AND action = 'reset_all'
    AND root_request_id = v_root_request_id
  FOR UPDATE;

  IF FOUND THEN
    -- A completed root request is terminal: later plan/rule membership changes
    -- must never make this same logical request acquire additional effects.
    IF v_existing.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing.reason <> v_reason
    THEN
      RAISE EXCEPTION 'usage_adjustment_idempotency_conflict' USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
      'ok', TRUE,
      'deduped', TRUE,
      'no_op', jsonb_array_length(v_existing.items) = 0,
      'items', v_existing.items,
      'created_at', v_existing.created_at
    );
  END IF;

  SELECT u.email
  INTO v_actor_email
  FROM auth.users AS u
  WHERE u.id = p_actor_user_id;

  IF v_actor_email IS NULL THEN
    v_actor_email := NULLIF(TRIM(COALESCE(p_actor_email, '')), '');
  END IF;

  INSERT INTO public.au_usage_admin_batch_receipts (
    user_id,
    action,
    root_request_id,
    actor_user_id,
    actor_email,
    reason,
    items
  )
  VALUES (
    p_target_user_id,
    'reset_all',
    v_root_request_id,
    p_actor_user_id,
    v_actor_email,
    v_reason,
    p_items
  )
  RETURNING * INTO v_inserted;

  -- The receipt and all child adjustments share one transaction. Any failure in
  -- the existing authoritative batch writer rolls the root receipt back too.
  IF jsonb_array_length(p_items) > 0 THEN
    v_batch_result := public.admin_adjust_usage_batch_versioned(
      p_actor_user_id,
      v_actor_email,
      p_target_user_id,
      v_reason,
      p_expected_usage_version,
      p_items
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'deduped', FALSE,
    'no_op', jsonb_array_length(v_inserted.items) = 0,
    'items', v_inserted.items,
    'batch', v_batch_result,
    'created_at', v_inserted.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_reset_all_versioned(
  UUID, TEXT, UUID, TEXT, TEXT, BIGINT, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_reset_all_versioned(
  UUID, TEXT, UUID, TEXT, TEXT, BIGINT, JSONB
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
