BEGIN;

-- A completed ingestion job already proves that the canonical chunk rows and
-- Qdrant points were generated and verified. Capture that durable output unit
-- in the same authoritative terminal usage event so processing cost can be
-- analyzed without introducing another mutable counter. This is descriptive
-- metering only: there is no plan limit or billing enforcement attached here.

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
VALUES (
  'indexed_chunks',
  'Indexed document chunks',
  'chunks',
  'processing',
  NULL,
  'monthly',
  NULL,
  NULL,
  TRUE,
  TRUE,
  0,
  NULL,
  'Canonical document chunks successfully persisted and indexed by completed ingestion jobs. Event-backed and deduplicated by worker job ID.'
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

CREATE OR REPLACE FUNCTION public.capture_worker_terminal_usage_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id UUID := COALESCE(NEW.owner_id, NEW.user_id);
  v_event_key TEXT;
  v_metrics JSONB;
  v_context JSONB;
  v_occurred_at TIMESTAMPTZ := now();
  v_plan TEXT := 'free';
  v_entitlement_source TEXT := NULL;
  v_plan_expires_at TIMESTAMPTZ := NULL;
  v_indexed_chunk_count BIGINT := 0;
  v_has_owner_id BOOLEAN := FALSE;
  v_has_user_id BOOLEAN := FALSE;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('completed', 'failed') THEN
    RETURN NEW;
  END IF;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'worker_usage_owner_required' USING ERRCODE = '22023';
  END IF;

  IF NEW.status = 'completed' AND NEW.completed_at IS NOT NULL THEN
    v_occurred_at := NEW.completed_at;
  END IF;

  SELECT
    CASE
      WHEN NULLIF(TRIM(COALESCE(e.admin_override_plan, '')), '') IS NOT NULL
        THEN LOWER(TRIM(e.admin_override_plan))
      WHEN e.expires_at IS NOT NULL AND e.expires_at <= v_occurred_at
        THEN 'free'
      ELSE LOWER(TRIM(COALESCE(NULLIF(e.plan, ''), 'free')))
    END,
    NULLIF(TRIM(COALESCE(e.source, '')), ''),
    e.expires_at
  INTO v_plan, v_entitlement_source, v_plan_expires_at
  FROM public.au_user_entitlements e
  WHERE e.user_id = v_owner_id;

  IF NOT FOUND THEN
    v_plan := 'free';
    v_entitlement_source := NULL;
    v_plan_expires_at := NULL;
  END IF;

  IF NEW.status = 'completed' THEN
    IF to_regclass('public.au_document_chunks') IS NULL THEN
      RAISE EXCEPTION 'worker_usage_chunk_table_required' USING ERRCODE = '42P01';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'au_document_chunks'
        AND column_name = 'owner_id'
    ) INTO v_has_owner_id;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'au_document_chunks'
        AND column_name = 'user_id'
    ) INTO v_has_user_id;

    IF v_has_owner_id AND v_has_user_id THEN
      EXECUTE 'SELECT COUNT(*) FROM public.au_document_chunks WHERE document_id = $1 AND (owner_id = $2 OR user_id = $2)'
      INTO v_indexed_chunk_count
      USING NEW.document_id, v_owner_id;
    ELSIF v_has_owner_id THEN
      EXECUTE 'SELECT COUNT(*) FROM public.au_document_chunks WHERE document_id = $1 AND owner_id = $2'
      INTO v_indexed_chunk_count
      USING NEW.document_id, v_owner_id;
    ELSIF v_has_user_id THEN
      EXECUTE 'SELECT COUNT(*) FROM public.au_document_chunks WHERE document_id = $1 AND user_id = $2'
      INTO v_indexed_chunk_count
      USING NEW.document_id, v_owner_id;
    ELSE
      EXECUTE 'SELECT COUNT(*) FROM public.au_document_chunks WHERE document_id = $1'
      INTO v_indexed_chunk_count
      USING NEW.document_id;
    END IF;
  END IF;

  v_event_key := 'worker_job:' || NEW.id::TEXT || ':' || NEW.status;
  v_metrics := CASE NEW.status
    WHEN 'completed' THEN
      jsonb_build_object('jobs_completed', 1)
      || CASE
           WHEN v_indexed_chunk_count > 0
             THEN jsonb_build_object('indexed_chunks', v_indexed_chunk_count)
           ELSE '{}'::jsonb
         END
    ELSE jsonb_build_object('jobs_failed', 1)
  END;

  v_context := jsonb_strip_nulls(jsonb_build_object(
    'job_id', NEW.id,
    'document_id', NEW.document_id,
    'outcome', NEW.status,
    'worker_id', NULLIF(TRIM(COALESCE(NEW.worker_id, '')), ''),
    'correlation_id', NULLIF(TRIM(COALESCE(NEW.correlation_id, '')), ''),
    'plan_snapshot', v_plan,
    'entitlement_source_snapshot', v_entitlement_source,
    'plan_expires_at_snapshot', v_plan_expires_at,
    'indexed_chunk_count', CASE WHEN NEW.status = 'completed' THEN v_indexed_chunk_count ELSE NULL END
  ));

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
    v_owner_id,
    'document_ingestion',
    'worker_status_transition',
    v_event_key,
    NULL,
    NULLIF(TRIM(COALESCE(NEW.correlation_id, '')), ''),
    v_metrics,
    v_context,
    v_occurred_at
  )
  ON CONFLICT (user_id, event_key) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_worker_terminal_usage_event() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_worker_terminal_usage_event() TO service_role;

DO $$
DECLARE
  v_definition TEXT;
  v_metric_count INTEGER;
BEGIN
  SELECT pg_get_functiondef('public.capture_worker_terminal_usage_event()'::regprocedure)
  INTO v_definition;

  IF v_definition NOT LIKE '%indexed_chunks%'
     OR v_definition NOT LIKE '%indexed_chunk_count%'
     OR v_definition NOT LIKE '%au_document_chunks%'
     OR v_definition NOT LIKE '%plan_snapshot%'
     OR v_definition NOT LIKE '%ON CONFLICT (user_id, event_key) DO NOTHING%' THEN
    RAISE EXCEPTION 'worker_indexed_chunk_metering_missing';
  END IF;

  SELECT COUNT(*)
  INTO v_metric_count
  FROM public.au_usage_metric_definitions
  WHERE metric_key = 'indexed_chunks'
    AND category = 'processing'
    AND limit_key IS NULL
    AND is_enabled = TRUE;

  IF v_metric_count <> 1 THEN
    RAISE EXCEPTION 'worker_indexed_chunk_metric_definition_missing';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
