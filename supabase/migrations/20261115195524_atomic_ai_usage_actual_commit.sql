-- Restore the server-side measured usage settlement RPC.
CREATE OR REPLACE FUNCTION public.ai_usage_delta_units(p_actual_units jsonb, p_reserved_units jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  WITH keys AS (
    SELECT key
    FROM jsonb_each(
      CASE WHEN jsonb_typeof(COALESCE(p_actual_units, '{}'::jsonb)) = 'object'
        THEN COALESCE(p_actual_units, '{}'::jsonb) ELSE '{}'::jsonb END
    )
    UNION
    SELECT key
    FROM jsonb_each(
      CASE WHEN jsonb_typeof(COALESCE(p_reserved_units, '{}'::jsonb)) = 'object'
        THEN COALESCE(p_reserved_units, '{}'::jsonb) ELSE '{}'::jsonb END
    )
  ),
  deltas AS (
    SELECT
      key,
      COALESCE(
        CASE WHEN jsonb_typeof(COALESCE(p_actual_units, '{}'::jsonb)->key) = 'number'
          THEN ((p_actual_units->>key)::numeric) END,
        0
      )
      -
      COALESCE(
        CASE WHEN jsonb_typeof(COALESCE(p_reserved_units, '{}'::jsonb)->key) = 'number'
          THEN ((p_reserved_units->>key)::numeric) END,
        0
      ) AS delta
    FROM keys
  )
  SELECT COALESCE(
    jsonb_object_agg(key, to_jsonb(delta)) FILTER (WHERE delta <> 0),
    '{}'::jsonb
  )
  FROM deltas;
$function$

CREATE OR REPLACE FUNCTION public.commit_ai_usage_actual(p_reservation_id uuid, p_user_id uuid, p_feature_key text, p_route text, p_idempotency_key text, p_actual_units jsonb DEFAULT NULL::jsonb, p_ticket_id text DEFAULT NULL::text, p_provider text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_prompt_tokens integer DEFAULT NULL::integer, p_completion_tokens integer DEFAULT NULL::integer, p_total_tokens integer DEFAULT NULL::integer, p_cost_usd numeric DEFAULT NULL::numeric, p_price_version text DEFAULT NULL::text, p_provider_request_id text DEFAULT NULL::text, p_latency_ms integer DEFAULT NULL::integer, p_correlation_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.ai_usage_reservations%ROWTYPE;
  v_actual_units jsonb;
  v_delta jsonb;
  v_event_id uuid;
  v_event_key text;
BEGIN
  PERFORM public.ai_usage_require_service_role();

  IF p_prompt_tokens IS NOT NULL AND p_prompt_tokens < 0
    OR p_completion_tokens IS NOT NULL AND p_completion_tokens < 0
    OR p_total_tokens IS NOT NULL AND p_total_tokens < 0
    OR p_latency_ms IS NOT NULL AND p_latency_ms < 0
    OR p_cost_usd IS NOT NULL AND p_cost_usd < 0 THEN
    RAISE EXCEPTION 'actual usage values must be non-negative'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_row
  FROM public.ai_usage_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'USAGE_RESERVATION_NOT_FOUND', 'status', 'missing'
    );
  END IF;

  IF v_row.user_id <> p_user_id
    OR v_row.feature_key <> p_feature_key
    OR v_row.route <> p_route
    OR v_row.idempotency_key <> p_idempotency_key THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'USAGE_RESERVATION_CLAIM_MISMATCH', 'status', v_row.status
    );
  END IF;

  IF v_row.status = 'committed' THEN
    SELECT id INTO v_event_id
    FROM public.au_usage_events
    WHERE user_id = v_row.user_id
      AND event_key = 'ai-reservation:' || v_row.id::text
    LIMIT 1;

    RETURN jsonb_build_object(
      'ok', true,
      'deduped', true,
      'reservation_id', v_row.id,
      'status', v_row.status,
      'event_id', v_event_id
    );
  END IF;

  IF v_row.status <> 'reserved' THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'USAGE_RESERVATION_NOT_ACTIVE', 'status', v_row.status
    );
  END IF;

  IF v_row.provider_started_at IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'USAGE_PROVIDER_NOT_STARTED', 'status', v_row.status
    );
  END IF;

  v_actual_units := COALESCE(p_actual_units, v_row.reserved_units);
  IF jsonb_typeof(v_actual_units) <> 'object' THEN
    RAISE EXCEPTION 'p_actual_units must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_each(v_actual_units) AS item(key, value)
    WHERE jsonb_typeof(value) <> 'number'
       OR (value::text)::numeric < 0
  ) THEN
    RAISE EXCEPTION 'actual usage units must be non-negative numbers'
      USING ERRCODE = '22023';
  END IF;

  -- Release over-reservation or charge any measured overage in the same transaction.
  v_delta := public.ai_usage_delta_units(v_actual_units, v_row.reserved_units);
  IF v_delta <> '{}'::jsonb THEN
    PERFORM public.increment_usage_counters(v_row.user_id, v_delta, v_row.usage_day);
  END IF;

  UPDATE public.ai_usage_reservations
  SET status = 'committed',
      committed_units = v_actual_units,
      provider = COALESCE(NULLIF(TRIM(COALESCE(p_provider, '')), ''), provider),
      model = COALESCE(NULLIF(TRIM(COALESCE(p_model, '')), ''), model),
      ticket_id = COALESCE(NULLIF(TRIM(COALESCE(p_ticket_id, '')), ''), ticket_id),
      committed_at = now(),
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  v_event_key := 'ai-reservation:' || v_row.id::text;

  INSERT INTO public.au_usage_events (
    user_id, feature, source, event_key, request_id, correlation_id,
    metric_increments, context, occurred_at,
    provider, model, prompt_tokens, completion_tokens, total_tokens,
    cost_usd, price_version, provider_request_id, latency_ms
  )
  VALUES (
    v_row.user_id,
    v_row.feature_key,
    'supabase-edge',
    v_event_key,
    COALESCE(NULLIF(TRIM(COALESCE(p_ticket_id, '')), ''), NULLIF(TRIM(COALESCE(p_provider_request_id, '')), '')),
    NULLIF(TRIM(COALESCE(p_correlation_id, '')), ''),
    v_actual_units,
    jsonb_strip_nulls(jsonb_build_object(
      'reservation_id', v_row.id,
      'route', v_row.route,
      'provider', NULLIF(TRIM(COALESCE(p_provider, '')), ''),
      'model', NULLIF(TRIM(COALESCE(p_model, '')), ''),
      'provider_request_id', NULLIF(TRIM(COALESCE(p_provider_request_id, '')), ''),
      'price_version', NULLIF(TRIM(COALESCE(p_price_version, '')), '')
    )),
    now(),
    NULLIF(TRIM(COALESCE(p_provider, '')), ''),
    NULLIF(TRIM(COALESCE(p_model, '')), ''),
    p_prompt_tokens,
    p_completion_tokens,
    p_total_tokens,
    p_cost_usd,
    NULLIF(TRIM(COALESCE(p_price_version, '')), ''),
    NULLIF(TRIM(COALESCE(p_provider_request_id, '')), ''),
    p_latency_ms
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
    'ok', true,
    'deduped', false,
    'reservation_id', v_row.id,
    'idempotency_key', v_row.idempotency_key,
    'status', v_row.status,
    'event_id', v_event_id,
    'actual_units', v_actual_units,
    'delta_units', v_delta
  );
END;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.commit_ai_usage_actual(uuid,uuid,text,text,text,jsonb,text,text,text,integer,integer,integer,numeric,text,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_ai_usage_actual(uuid,uuid,text,text,text,jsonb,text,text,text,integer,integer,integer,numeric,text,text,integer,text) TO service_role;
