-- Make webhook idempotency retry-safe. A receipt is not a processed event:
-- transient failures must be reclaimable, while concurrent/stale workers are fenced.
ALTER TABLE public.billing_webhook_events
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_token uuid,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.claim_billing_webhook_event(
  p_event_id text,
  p_event_type text,
  p_reference text,
  p_idempotency_key text,
  p_payload jsonb,
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_id bigint;
  v_row public.billing_webhook_events%ROWTYPE;
  v_claim_token uuid := gen_random_uuid();
  v_lease_seconds integer := GREATEST(15, LEAST(COALESCE(p_lease_seconds, 120), 900));
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_idempotency_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'webhook_idempotency_key_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.billing_webhook_events (
    event_id, event_type, reference, idempotency_key, payload, status,
    processed_at, attempt_count, processing_started_at, processing_token, updated_at
  )
  VALUES (
    NULLIF(TRIM(COALESCE(p_event_id, '')), ''),
    COALESCE(NULLIF(TRIM(COALESCE(p_event_type, '')), ''), 'unknown'),
    NULLIF(TRIM(COALESCE(p_reference, '')), ''),
    TRIM(p_idempotency_key),
    COALESCE(p_payload, '{}'::jsonb),
    'processing',
    NULL,
    1,
    now(),
    v_claim_token,
    now()
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'should_process', true, 'duplicate', false,
      'status', 'processing', 'attempt_count', 1, 'claim_token', v_claim_token
    );
  END IF;

  SELECT *
  INTO v_row
  FROM public.billing_webhook_events
  WHERE idempotency_key = TRIM(p_idempotency_key)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'webhook_event_claim_missing' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status = 'processed' THEN
    RETURN jsonb_build_object(
      'ok', true, 'should_process', false, 'duplicate', true,
      'status', 'processed', 'attempt_count', v_row.attempt_count
    );
  END IF;

  IF v_row.status = 'processing'
    AND v_row.processing_started_at IS NOT NULL
    AND v_row.processing_started_at > now() - make_interval(secs => v_lease_seconds) THEN
    RETURN jsonb_build_object(
      'ok', true, 'should_process', false, 'duplicate', true,
      'status', 'processing', 'in_progress', true, 'attempt_count', v_row.attempt_count
    );
  END IF;

  UPDATE public.billing_webhook_events
  SET event_id = COALESCE(NULLIF(TRIM(COALESCE(p_event_id, '')), ''), event_id),
      event_type = COALESCE(NULLIF(TRIM(COALESCE(p_event_type, '')), ''), event_type),
      reference = COALESCE(NULLIF(TRIM(COALESCE(p_reference, '')), ''), reference),
      payload = COALESCE(p_payload, payload),
      status = 'processing',
      processed_at = NULL,
      processing_started_at = now(),
      processing_token = v_claim_token,
      attempt_count = GREATEST(COALESCE(attempt_count, 0), 0) + 1,
      last_error = NULL,
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true, 'should_process', true, 'duplicate', false,
    'status', 'processing', 'attempt_count', v_row.attempt_count,
    'claim_token', v_claim_token
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_billing_webhook_event_processed(
  p_idempotency_key text,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.billing_webhook_events
  SET status = 'processed',
      processed_at = now(),
      processing_started_at = NULL,
      processing_token = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE idempotency_key = TRIM(COALESCE(p_idempotency_key, ''))
    AND processing_token = p_claim_token
    AND status = 'processing';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'WEBHOOK_CLAIM_LOST');
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 'processed');
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_billing_webhook_event_failed(
  p_idempotency_key text,
  p_claim_token uuid,
  p_error_code text DEFAULT 'webhook_processing_failed'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_error_code text := COALESCE(NULLIF(TRIM(COALESCE(p_error_code, '')), ''), 'webhook_processing_failed');
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  IF v_error_code !~ '^[A-Za-z0-9_.:-]{1,80}$' THEN
    v_error_code := 'webhook_processing_failed';
  END IF;

  UPDATE public.billing_webhook_events
  SET status = 'failed',
      processing_started_at = NULL,
      processing_token = NULL,
      last_error = v_error_code,
      updated_at = now()
  WHERE idempotency_key = TRIM(COALESCE(p_idempotency_key, ''))
    AND processing_token = p_claim_token
    AND status = 'processing';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'WEBHOOK_CLAIM_LOST');
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 'failed');
END;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.claim_billing_webhook_event(text, text, text, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.mark_billing_webhook_event_processed(text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.mark_billing_webhook_event_failed(text, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_billing_webhook_event(text, text, text, text, jsonb, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_billing_webhook_event_processed(text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_billing_webhook_event_failed(text, uuid, text)
  TO service_role;
