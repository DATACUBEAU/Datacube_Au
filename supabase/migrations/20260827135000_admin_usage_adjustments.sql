-- Auditable per-user usage corrections for the active quota window.
--
-- Admin resets/decreases do not delete usage history or mutate feature records.
-- Instead, an append-only signed delta is applied on top of the canonical usage
-- calculation for the exact quota window. When that window ends, the correction
-- naturally expires and the next window starts from normal tracked usage.

BEGIN;

CREATE TABLE IF NOT EXISTS public.au_usage_admin_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL REFERENCES public.au_usage_metric_definitions(metric_key) ON DELETE RESTRICT,
  delta NUMERIC NOT NULL CHECK (delta <> 0),
  action TEXT NOT NULL CHECK (action IN ('increase', 'decrease', 'set', 'reset')),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NULL,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_email TEXT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  request_id TEXT NOT NULL CHECK (length(trim(request_id)) BETWEEN 8 AND 200),
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, metric_key, request_id)
);

CREATE INDEX IF NOT EXISTS idx_au_usage_admin_adjustments_user_metric_window
  ON public.au_usage_admin_adjustments (user_id, metric_key, window_start, window_end, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_au_usage_admin_adjustments_actor_time
  ON public.au_usage_admin_adjustments (actor_user_id, created_at DESC);

ALTER TABLE public.au_usage_admin_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.au_usage_admin_adjustments FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.au_usage_admin_adjustments TO service_role;

DROP POLICY IF EXISTS "service role can manage usage admin adjustments" ON public.au_usage_admin_adjustments;
CREATE POLICY "service role can manage usage admin adjustments"
  ON public.au_usage_admin_adjustments
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

CREATE OR REPLACE FUNCTION public.get_usage_admin_adjustment_total(
  p_user_id UUID,
  p_metric_key TEXT,
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_total NUMERIC := 0;
BEGIN
  IF p_user_id IS NULL OR NULLIF(TRIM(COALESCE(p_metric_key, '')), '') IS NULL OR p_window_start IS NULL THEN
    RETURN 0;
  END IF;

  IF v_role <> 'service_role' THEN
    IF v_requester IS NULL THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
    END IF;
    IF v_requester <> p_user_id AND NOT public.is_conex_admin(v_requester) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT COALESCE(SUM(delta), 0)
  INTO v_total
  FROM public.au_usage_admin_adjustments
  WHERE user_id = p_user_id
    AND metric_key = TRIM(p_metric_key)
    AND window_start = p_window_start
    AND (
      (window_end IS NULL AND p_window_end IS NULL)
      OR window_end = p_window_end
    );

  RETURN COALESCE(v_total, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_usage_admin_adjustment_total(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_usage_admin_adjustment_total(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_usage_admin_adjustment_total(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_adjust_usage(
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
  p_context JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_metric_key TEXT := NULLIF(TRIM(COALESCE(p_metric_key, '')), '');
  v_action TEXT := LOWER(NULLIF(TRIM(COALESCE(p_action, '')), ''));
  v_reason TEXT := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  v_request_id TEXT := NULLIF(TRIM(COALESCE(p_request_id, '')), '');
  v_existing public.au_usage_admin_adjustments%ROWTYPE;
  v_inserted public.au_usage_admin_adjustments%ROWTYPE;
  v_definition public.au_usage_metric_definitions%ROWTYPE;
  v_total NUMERIC := 0;
BEGIN
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'missing_actor_or_target' USING ERRCODE = '22023';
  END IF;

  IF v_role <> 'service_role' THEN
    IF v_requester IS NULL OR v_requester <> p_actor_user_id OR NOT public.is_conex_admin(v_requester) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'target_user_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_metric_key IS NULL OR p_delta IS NULL OR p_delta = 0 OR p_window_start IS NULL THEN
    RAISE EXCEPTION 'invalid_usage_adjustment' USING ERRCODE = '22023';
  END IF;

  IF v_action NOT IN ('increase', 'decrease', 'set', 'reset') THEN
    RAISE EXCEPTION 'invalid_usage_adjustment_action' USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'usage_adjustment_reason_required' USING ERRCODE = '22023';
  END IF;

  IF v_request_id IS NULL OR length(v_request_id) < 8 OR length(v_request_id) > 200 THEN
    RAISE EXCEPTION 'usage_adjustment_request_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_definition
  FROM public.au_usage_metric_definitions
  WHERE metric_key = v_metric_key
    AND is_enabled = TRUE;

  IF NOT FOUND OR COALESCE(v_definition.limit_key, '') <> v_metric_key THEN
    RAISE EXCEPTION 'unsupported_usage_adjustment_metric:%', v_metric_key USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.au_usage_admin_adjustments
  WHERE user_id = p_target_user_id
    AND metric_key = v_metric_key
    AND request_id = v_request_id
  LIMIT 1;

  IF FOUND THEN
    SELECT public.get_usage_admin_adjustment_total(
      p_target_user_id,
      v_metric_key,
      v_existing.window_start,
      v_existing.window_end
    ) INTO v_total;

    RETURN jsonb_build_object(
      'ok', TRUE,
      'deduped', TRUE,
      'adjustment_id', v_existing.id,
      'delta', v_existing.delta,
      'adjustment_total', COALESCE(v_total, 0),
      'created_at', v_existing.created_at
    );
  END IF;

  INSERT INTO public.au_usage_admin_adjustments (
    user_id,
    metric_key,
    delta,
    action,
    window_start,
    window_end,
    actor_user_id,
    actor_email,
    reason,
    request_id,
    context
  ) VALUES (
    p_target_user_id,
    v_metric_key,
    p_delta,
    v_action,
    p_window_start,
    p_window_end,
    p_actor_user_id,
    NULLIF(TRIM(COALESCE(p_actor_email, '')), ''),
    v_reason,
    v_request_id,
    COALESCE(p_context, '{}'::jsonb)
  )
  RETURNING * INTO v_inserted;

  SELECT public.get_usage_admin_adjustment_total(
    p_target_user_id,
    v_metric_key,
    p_window_start,
    p_window_end
  ) INTO v_total;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'deduped', FALSE,
    'adjustment_id', v_inserted.id,
    'delta', v_inserted.delta,
    'adjustment_total', COALESCE(v_total, 0),
    'created_at', v_inserted.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_usage(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
