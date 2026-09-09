BEGIN;

-- Worker ingestion events already carry owner/job/document provenance. Snapshot
-- the server-side entitlement state as well so processing cost can be audited
-- against the plan that was in force when the terminal transition occurred.
-- This is descriptive attribution only: it does not change plan enforcement or
-- introduce a second entitlement source of truth.

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

  v_event_key := 'worker_job:' || NEW.id::TEXT || ':' || NEW.status;
  v_metrics := CASE NEW.status
    WHEN 'completed' THEN jsonb_build_object('jobs_completed', 1)
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
    'plan_expires_at_snapshot', v_plan_expires_at
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
BEGIN
  SELECT pg_get_functiondef('public.capture_worker_terminal_usage_event()'::regprocedure)
  INTO v_definition;

  IF v_definition NOT LIKE '%plan_snapshot%'
     OR v_definition NOT LIKE '%admin_override_plan%'
     OR v_definition NOT LIKE '%entitlement_source_snapshot%'
     OR v_definition NOT LIKE '%plan_expires_at_snapshot%' THEN
    RAISE EXCEPTION 'worker_usage_plan_attribution_missing';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
