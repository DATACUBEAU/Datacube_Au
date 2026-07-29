BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_usage_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  route TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL DEFAULT '',
  estimated_units INTEGER NOT NULL DEFAULT 1,
  reserved_units JSONB NOT NULL DEFAULT '{}'::jsonb,
  committed_units JSONB NOT NULL DEFAULT '{}'::jsonb,
  limit_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'reserved',
  provider TEXT NULL,
  model TEXT NULL,
  ticket_id TEXT NULL,
  usage_day DATE NOT NULL DEFAULT current_date,
  provider_started_at TIMESTAMPTZ NULL,
  last_attempt_at TIMESTAMPTZ NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  committed_at TIMESTAMPTZ NULL,
  released_at TIMESTAMPTZ NULL,
  failure_code TEXT NULL
);

ALTER TABLE public.ai_usage_reservations
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS estimated_units INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reserved_units JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS committed_units JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS limit_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS provider TEXT NULL,
  ADD COLUMN IF NOT EXISTS model TEXT NULL,
  ADD COLUMN IF NOT EXISTS ticket_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS usage_day DATE NOT NULL DEFAULT current_date,
  ADD COLUMN IF NOT EXISTS provider_started_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  ADD COLUMN IF NOT EXISTS committed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS failure_code TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_usage_reservations_status_check'
      AND conrelid = 'public.ai_usage_reservations'::regclass
  ) THEN
    ALTER TABLE public.ai_usage_reservations
      ADD CONSTRAINT ai_usage_reservations_status_check
      CHECK (status IN ('reserved', 'committed', 'released', 'expired', 'disputed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_usage_reservations_estimated_units_check'
      AND conrelid = 'public.ai_usage_reservations'::regclass
  ) THEN
    ALTER TABLE public.ai_usage_reservations
      ADD CONSTRAINT ai_usage_reservations_estimated_units_check
      CHECK (estimated_units >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_usage_reservations_attempt_count_check'
      AND conrelid = 'public.ai_usage_reservations'::regclass
  ) THEN
    ALTER TABLE public.ai_usage_reservations
      ADD CONSTRAINT ai_usage_reservations_attempt_count_check
      CHECK (attempt_count >= 0);
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_usage_reservations_user_feature_idempotency
  ON public.ai_usage_reservations (user_id, feature_key, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_ai_usage_reservations_user_status_expires
  ON public.ai_usage_reservations (user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_ai_usage_reservations_status_expires
  ON public.ai_usage_reservations (status, expires_at)
  WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_ai_usage_reservations_ticket_id
  ON public.ai_usage_reservations (ticket_id)
  WHERE ticket_id IS NOT NULL;

ALTER TABLE public.ai_usage_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_usage_reservations FROM PUBLIC;
REVOKE ALL ON TABLE public.ai_usage_reservations FROM anon, authenticated;
GRANT ALL ON TABLE public.ai_usage_reservations TO service_role;

DROP POLICY IF EXISTS "service role can manage ai usage reservations" ON public.ai_usage_reservations;
CREATE POLICY "service role can manage ai usage reservations"
  ON public.ai_usage_reservations
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

INSERT INTO public.au_usage_metric_definitions (
  metric_key,
  label,
  unit,
  category,
  limit_key,
  reset_policy,
  reset_interval_value,
  reset_interval_unit,
  is_enabled,
  is_integer,
  min_value,
  max_value,
  description
)
VALUES
  (
    'prompt_starters_per_day',
    'Prompt Starters',
    'generations',
    'generation',
    'prompt_starters_per_day',
    'daily',
    NULL,
    NULL,
    TRUE,
    TRUE,
    0,
    NULL,
    'Prompt starter generation reservations counted after successful AI completion.'
  )
ON CONFLICT (metric_key) DO UPDATE
SET label = EXCLUDED.label,
    unit = EXCLUDED.unit,
    category = EXCLUDED.category,
    limit_key = EXCLUDED.limit_key,
    reset_policy = EXCLUDED.reset_policy,
    reset_interval_value = EXCLUDED.reset_interval_value,
    reset_interval_unit = EXCLUDED.reset_interval_unit,
    is_enabled = EXCLUDED.is_enabled,
    is_integer = EXCLUDED.is_integer,
    min_value = EXCLUDED.min_value,
    max_value = EXCLUDED.max_value,
    description = EXCLUDED.description,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.ai_usage_require_service_role()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_usage_negate_units(p_units JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_object_agg(key, to_jsonb(-((value::text)::numeric))),
    '{}'::jsonb
  )
  FROM jsonb_each(COALESCE(p_units, '{}'::jsonb))
  WHERE jsonb_typeof(value) = 'number';
$$;

CREATE OR REPLACE FUNCTION public.ai_usage_jsonb_numeric_value(p_source JSONB, p_key TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_raw TEXT;
BEGIN
  IF p_source IS NULL OR p_key IS NULL OR TRIM(p_key) = '' THEN
    RETURN 0;
  END IF;
  v_raw := p_source ->> p_key;
  IF v_raw IS NULL OR v_raw !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
    RETURN 0;
  END IF;
  RETURN v_raw::numeric;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_ai_usage(
  p_user_id UUID,
  p_feature_key TEXT,
  p_route TEXT,
  p_idempotency_key TEXT,
  p_request_fingerprint TEXT DEFAULT '',
  p_metric_increments JSONB DEFAULT '{}'::jsonb,
  p_limit_checks JSONB DEFAULT '[]'::jsonb,
  p_estimated_units INTEGER DEFAULT 1,
  p_ticket_id TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.ai_usage_reservations%ROWTYPE;
  v_today JSONB := '{}'::jsonb;
  v_total JSONB := '{}'::jsonb;
  v_usage_day DATE := (now() AT TIME ZONE 'UTC')::date;
  v_expires_at TIMESTAMPTZ := COALESCE(p_expires_at, now() + interval '15 minutes');
  v_check JSONB;
  v_metric_key TEXT;
  v_cap NUMERIC;
  v_current NUMERIC;
  v_increment NUMERIC;
  v_snapshot JSONB := '{}'::jsonb;
  v_reservation_id UUID;
BEGIN
  PERFORM public.ai_usage_require_service_role();

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(TRIM(COALESCE(p_feature_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'p_feature_key is required' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(TRIM(COALESCE(p_route, '')), '') IS NULL THEN
    RAISE EXCEPTION 'p_route is required' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(TRIM(COALESCE(p_idempotency_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'p_idempotency_key is required' USING ERRCODE = '22023';
  END IF;
  IF p_metric_increments IS NULL OR jsonb_typeof(p_metric_increments) <> 'object' OR p_metric_increments = '{}'::jsonb THEN
    RAISE EXCEPTION 'p_metric_increments must be a non-empty object' USING ERRCODE = '22023';
  END IF;
  IF p_limit_checks IS NULL OR jsonb_typeof(p_limit_checks) <> 'array' THEN
    p_limit_checks := '[]'::jsonb;
  END IF;

  INSERT INTO public.usage_counters (user_id, day, counters)
  VALUES (p_user_id, v_usage_day, '{}'::jsonb)
  ON CONFLICT (user_id, day) DO NOTHING;

  INSERT INTO public.usage_totals (user_id, counters)
  VALUES (p_user_id, '{}'::jsonb)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT counters
  INTO v_today
  FROM public.usage_counters
  WHERE user_id = p_user_id
    AND day = v_usage_day
  FOR UPDATE;

  SELECT counters
  INTO v_total
  FROM public.usage_totals
  WHERE user_id = p_user_id
  FOR UPDATE;

  SELECT *
  INTO v_existing
  FROM public.ai_usage_reservations
  WHERE user_id = p_user_id
    AND feature_key = p_feature_key
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status = 'reserved' AND v_existing.expires_at <= now() THEN
      PERFORM public.increment_usage_counters(
        v_existing.user_id,
        public.ai_usage_negate_units(v_existing.reserved_units),
        v_existing.usage_day
      );

      UPDATE public.ai_usage_reservations
      SET status = 'expired',
          released_at = now(),
          failure_code = COALESCE(failure_code, 'expired_reservation'),
          updated_at = now()
      WHERE id = v_existing.id
      RETURNING * INTO v_existing;
    END IF;

    IF v_existing.status = 'reserved' THEN
      UPDATE public.ai_usage_reservations
      SET ticket_id = COALESCE(NULLIF(TRIM(COALESCE(p_ticket_id, '')), ''), ticket_id),
          expires_at = GREATEST(expires_at, v_expires_at),
          updated_at = now()
      WHERE id = v_existing.id
      RETURNING * INTO v_existing;

      RETURN jsonb_build_object(
        'ok', TRUE,
        'deduped', TRUE,
        'reservation_id', v_existing.id,
        'idempotency_key', v_existing.idempotency_key,
        'status', v_existing.status,
        'expires_at', v_existing.expires_at
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', FALSE,
      'deduped', TRUE,
      'reservation_id', v_existing.id,
      'idempotency_key', v_existing.idempotency_key,
      'status', v_existing.status,
      'code', 'USAGE_RESERVATION_NOT_ACTIVE'
    );
  END IF;

  FOR v_check IN SELECT value FROM jsonb_array_elements(p_limit_checks)
  LOOP
    v_metric_key := NULLIF(TRIM(COALESCE(v_check ->> 'metric_key', '')), '');
    IF v_metric_key IS NULL OR NULLIF(TRIM(COALESCE(v_check ->> 'cap', '')), '') IS NULL THEN
      CONTINUE;
    END IF;

    v_cap := (v_check ->> 'cap')::numeric;
    IF v_cap < 0 THEN
      v_cap := 0;
    END IF;

    v_increment := public.ai_usage_jsonb_numeric_value(p_metric_increments, v_metric_key);
    IF v_increment <= 0 THEN
      CONTINUE;
    END IF;

    v_current := public.ai_usage_jsonb_numeric_value(COALESCE(v_total, '{}'::jsonb), v_metric_key);
    IF v_current + v_increment > v_cap THEN
      RETURN jsonb_build_object(
        'ok', FALSE,
        'code', 'USAGE_LIMIT_EXCEEDED',
        'metric_key', v_metric_key,
        'limit', v_cap,
        'current', v_current,
        'requested', v_increment,
        'status', 'rejected'
      );
    END IF;
  END LOOP;

  v_snapshot := public.increment_usage_counters(p_user_id, p_metric_increments, v_usage_day);

  INSERT INTO public.ai_usage_reservations (
    user_id,
    feature_key,
    route,
    idempotency_key,
    request_fingerprint,
    estimated_units,
    reserved_units,
    limit_checks,
    status,
    ticket_id,
    usage_day,
    expires_at
  )
  VALUES (
    p_user_id,
    TRIM(p_feature_key),
    TRIM(p_route),
    TRIM(p_idempotency_key),
    TRIM(COALESCE(p_request_fingerprint, '')),
    GREATEST(0, COALESCE(p_estimated_units, 1)),
    p_metric_increments,
    p_limit_checks,
    'reserved',
    NULLIF(TRIM(COALESCE(p_ticket_id, '')), ''),
    v_usage_day,
    v_expires_at
  )
  RETURNING id INTO v_reservation_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'deduped', FALSE,
    'reservation_id', v_reservation_id,
    'idempotency_key', TRIM(p_idempotency_key),
    'status', 'reserved',
    'expires_at', v_expires_at,
    'snapshot', COALESCE(v_snapshot, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_ai_usage_reservation(
  p_reservation_id UUID,
  p_user_id UUID,
  p_feature_key TEXT,
  p_route TEXT,
  p_idempotency_key TEXT,
  p_ticket_id TEXT DEFAULT NULL,
  p_provider TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.ai_usage_reservations%ROWTYPE;
BEGIN
  PERFORM public.ai_usage_require_service_role();

  SELECT *
  INTO v_row
  FROM public.ai_usage_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_NOT_FOUND', 'status', 'missing');
  END IF;

  IF v_row.user_id <> p_user_id
    OR v_row.feature_key <> p_feature_key
    OR v_row.route <> p_route
    OR v_row.idempotency_key <> p_idempotency_key THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_CLAIM_MISMATCH', 'status', v_row.status);
  END IF;

  IF v_row.status = 'reserved' AND v_row.expires_at <= now() THEN
    PERFORM public.increment_usage_counters(v_row.user_id, public.ai_usage_negate_units(v_row.reserved_units), v_row.usage_day);
    UPDATE public.ai_usage_reservations
    SET status = 'expired',
        released_at = now(),
        failure_code = COALESCE(failure_code, 'expired_reservation'),
        updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  IF v_row.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_NOT_ACTIVE', 'status', v_row.status);
  END IF;

  IF v_row.provider_started_at IS NOT NULL
    AND v_row.provider_started_at > now() - interval '2 minutes' THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_REQUEST_IN_PROGRESS', 'status', v_row.status);
  END IF;

  UPDATE public.ai_usage_reservations
  SET provider_started_at = COALESCE(provider_started_at, now()),
      last_attempt_at = now(),
      attempt_count = attempt_count + 1,
      provider = COALESCE(NULLIF(TRIM(COALESCE(p_provider, '')), ''), provider),
      model = COALESCE(NULLIF(TRIM(COALESCE(p_model, '')), ''), model),
      ticket_id = COALESCE(NULLIF(TRIM(COALESCE(p_ticket_id, '')), ''), ticket_id),
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'reservation_id', v_row.id,
    'idempotency_key', v_row.idempotency_key,
    'status', v_row.status,
    'attempt_count', v_row.attempt_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_ai_usage(
  p_reservation_id UUID,
  p_user_id UUID,
  p_feature_key TEXT,
  p_route TEXT,
  p_idempotency_key TEXT,
  p_ticket_id TEXT DEFAULT NULL,
  p_provider TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.ai_usage_reservations%ROWTYPE;
  v_event_id UUID;
  v_event_key TEXT;
BEGIN
  PERFORM public.ai_usage_require_service_role();

  SELECT *
  INTO v_row
  FROM public.ai_usage_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_NOT_FOUND', 'status', 'missing');
  END IF;

  IF v_row.user_id <> p_user_id
    OR v_row.feature_key <> p_feature_key
    OR v_row.route <> p_route
    OR v_row.idempotency_key <> p_idempotency_key THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_CLAIM_MISMATCH', 'status', v_row.status);
  END IF;

  IF v_row.status = 'committed' THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'deduped', TRUE,
      'reservation_id', v_row.id,
      'idempotency_key', v_row.idempotency_key,
      'status', v_row.status
    );
  END IF;

  IF v_row.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_NOT_ACTIVE', 'status', v_row.status);
  END IF;

  UPDATE public.ai_usage_reservations
  SET status = 'committed',
      committed_units = reserved_units,
      provider = COALESCE(NULLIF(TRIM(COALESCE(p_provider, '')), ''), provider),
      model = COALESCE(NULLIF(TRIM(COALESCE(p_model, '')), ''), model),
      ticket_id = COALESCE(NULLIF(TRIM(COALESCE(p_ticket_id, '')), ''), ticket_id),
      committed_at = now(),
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  v_event_key := 'ai-reservation:' || v_row.id::text;

  INSERT INTO public.au_usage_events (
    user_id,
    feature,
    source,
    event_key,
    request_id,
    correlation_id,
    metric_increments,
    context,
    occurred_at
  )
  VALUES (
    v_row.user_id,
    v_row.feature_key,
    'vps-ai-gateway',
    v_event_key,
    NULLIF(TRIM(COALESCE(p_ticket_id, '')), ''),
    NULL,
    v_row.committed_units,
    jsonb_build_object(
      'reservation_id', v_row.id,
      'route', v_row.route,
      'provider', COALESCE(v_row.provider, ''),
      'model', COALESCE(v_row.model, '')
    ),
    now()
  )
  ON CONFLICT (user_id, event_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id
    FROM public.au_usage_events
    WHERE user_id = v_row.user_id
      AND event_key = v_event_key
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'deduped', FALSE,
    'reservation_id', v_row.id,
    'idempotency_key', v_row.idempotency_key,
    'status', v_row.status,
    'event_id', v_event_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_ai_usage(
  p_reservation_id UUID,
  p_user_id UUID,
  p_feature_key TEXT,
  p_route TEXT,
  p_idempotency_key TEXT,
  p_ticket_id TEXT DEFAULT NULL,
  p_failure_code TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'released'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.ai_usage_reservations%ROWTYPE;
  v_next_status TEXT := COALESCE(NULLIF(TRIM(COALESCE(p_status, '')), ''), 'released');
  v_snapshot JSONB := '{}'::jsonb;
BEGIN
  PERFORM public.ai_usage_require_service_role();

  IF v_next_status NOT IN ('released', 'expired', 'disputed') THEN
    v_next_status := 'released';
  END IF;

  SELECT *
  INTO v_row
  FROM public.ai_usage_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_NOT_FOUND', 'status', 'missing');
  END IF;

  IF v_row.user_id <> p_user_id
    OR v_row.feature_key <> p_feature_key
    OR v_row.route <> p_route
    OR v_row.idempotency_key <> p_idempotency_key THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_CLAIM_MISMATCH', 'status', v_row.status);
  END IF;

  IF v_row.status IN ('committed', 'released', 'expired', 'disputed') THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'deduped', TRUE,
      'reservation_id', v_row.id,
      'idempotency_key', v_row.idempotency_key,
      'status', v_row.status
    );
  END IF;

  v_snapshot := public.increment_usage_counters(
    v_row.user_id,
    public.ai_usage_negate_units(v_row.reserved_units),
    v_row.usage_day
  );

  UPDATE public.ai_usage_reservations
  SET status = v_next_status,
      released_at = now(),
      ticket_id = COALESCE(NULLIF(TRIM(COALESCE(p_ticket_id, '')), ''), ticket_id),
      failure_code = NULLIF(TRIM(COALESCE(p_failure_code, '')), ''),
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'deduped', FALSE,
    'reservation_id', v_row.id,
    'idempotency_key', v_row.idempotency_key,
    'status', v_row.status,
    'snapshot', COALESCE(v_snapshot, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_ai_usage_reservations(p_limit INTEGER DEFAULT 500)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 5000);
  v_count INTEGER := 0;
  v_row public.ai_usage_reservations%ROWTYPE;
BEGIN
  PERFORM public.ai_usage_require_service_role();

  FOR v_row IN
    SELECT *
    FROM public.ai_usage_reservations
    WHERE status = 'reserved'
      AND expires_at <= now()
    ORDER BY expires_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.increment_usage_counters(v_row.user_id, public.ai_usage_negate_units(v_row.reserved_units), v_row.usage_day);

    UPDATE public.ai_usage_reservations
    SET status = 'expired',
        released_at = now(),
        failure_code = COALESCE(failure_code, 'expired_reservation'),
        updated_at = now()
    WHERE id = v_row.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', TRUE, 'expired', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_usage_require_service_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_usage_negate_units(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_usage_jsonb_numeric_value(JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_ai_usage(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_ai_usage_reservation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_ai_usage(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_ai_usage(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_ai_usage_reservations(INTEGER) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.ai_usage_require_service_role() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_usage_negate_units(JSONB) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_usage_jsonb_numeric_value(JSONB, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_ai_usage(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_ai_usage_reservation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_ai_usage(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.release_ai_usage(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_ai_usage_reservations(INTEGER) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_ai_usage(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_ai_usage_reservation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_ai_usage(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_ai_usage(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_ai_usage_reservations(INTEGER) TO service_role;

COMMIT;
