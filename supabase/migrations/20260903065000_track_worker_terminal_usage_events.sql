BEGIN;

-- Worker processing is a real cost-driving product activity, but the worker's
-- historical jobs_completed/jobs_failed snapshots are not auditable and can be
-- incremented more than once when a terminal path is retried. Capture the
-- durable terminal state transition in the authoritative append-only usage
-- ledger. The existing snapshot counters remain a compatibility projection for
-- now; this trigger does not mutate them, so it cannot double-increment them.

ALTER TABLE public.au_usage_metric_definitions
  DROP CONSTRAINT IF EXISTS au_usage_metric_definitions_category_check;

ALTER TABLE public.au_usage_metric_definitions
  ADD CONSTRAINT au_usage_metric_definitions_category_check
  CHECK (category IN ('chat', 'token', 'storage', 'generation', 'media', 'api', 'legacy', 'processing'));

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
    'jobs_completed',
    'Documents processed',
    'jobs',
    'processing',
    NULL,
    'monthly',
    NULL,
    NULL,
    TRUE,
    TRUE,
    0,
    NULL,
    'Successfully completed document-ingestion jobs. Event-backed and deduplicated by worker job ID.'
  ),
  (
    'jobs_failed',
    'Processing failures',
    'jobs',
    'processing',
    NULL,
    'monthly',
    NULL,
    NULL,
    TRUE,
    TRUE,
    0,
    NULL,
    'Document-ingestion jobs that reached a failed terminal state. Event-backed and deduplicated by worker job ID.'
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
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     OR NEW.status NOT IN ('completed', 'failed') THEN
    RETURN NEW;
  END IF;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'worker_usage_owner_required' USING ERRCODE = '22023';
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
    'correlation_id', NULLIF(TRIM(COALESCE(NEW.correlation_id, '')), '')
  ));

  IF NEW.status = 'completed' AND NEW.completed_at IS NOT NULL THEN
    v_occurred_at := NEW.completed_at;
  END IF;

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

DROP TRIGGER IF EXISTS trg_capture_worker_terminal_usage_event ON public.au_worker_jobs;
CREATE TRIGGER trg_capture_worker_terminal_usage_event
AFTER UPDATE OF status ON public.au_worker_jobs
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  AND NEW.status IN ('completed', 'failed')
)
EXECUTE FUNCTION public.capture_worker_terminal_usage_event();

-- Clean-rebuild invariants: this migration should fail loudly if later edits
-- accidentally remove the terminal event hook or its processing definitions.
DO $$
DECLARE
  v_trigger_count INTEGER;
  v_metric_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_trigger_count
  FROM pg_trigger
  WHERE tgrelid = 'public.au_worker_jobs'::regclass
    AND tgname = 'trg_capture_worker_terminal_usage_event'
    AND NOT tgisinternal;

  IF v_trigger_count <> 1 THEN
    RAISE EXCEPTION 'worker_terminal_usage_trigger_missing';
  END IF;

  SELECT COUNT(*)
  INTO v_metric_count
  FROM public.au_usage_metric_definitions
  WHERE metric_key IN ('jobs_completed', 'jobs_failed')
    AND category = 'processing'
    AND is_enabled = TRUE;

  IF v_metric_count <> 2 THEN
    RAISE EXCEPTION 'worker_terminal_usage_metrics_missing';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
