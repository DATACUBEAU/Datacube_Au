BEGIN;

INSERT INTO public.au_plans (plan, is_default)
VALUES
  ('free', TRUE),
  ('pro', FALSE),
  ('premium', FALSE)
ON CONFLICT (plan) DO UPDATE
SET is_default = EXCLUDED.is_default;

CREATE TABLE IF NOT EXISTS public.au_plan_limit_rules (
  scope TEXT NOT NULL,
  limit_key TEXT NOT NULL,
  value BIGINT NULL,
  mode TEXT NOT NULL DEFAULT 'usage',
  reset_policy TEXT NOT NULL DEFAULT 'never',
  reset_interval_value INT NULL,
  reset_interval_unit TEXT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_unlimited BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, limit_key),
  CONSTRAINT au_plan_limit_rules_scope_check CHECK (scope IN ('default', 'free', 'pro', 'premium')),
  CONSTRAINT au_plan_limit_rules_key_check CHECK (
    limit_key IN (
      'max_chats_total',
      'max_uploads_total',
      'max_tokens_total',
      'max_file_size_mb',
      'max_concurrent_jobs',
      'max_exam_predictions',
      'max_practice_exams',
      'max_knowledge_hub'
    )
  ),
  CONSTRAINT au_plan_limit_rules_value_check CHECK (value IS NULL OR value >= 0),
  CONSTRAINT au_plan_limit_rules_mode_check CHECK (mode IN ('usage', 'current', 'per_request', 'concurrency')),
  CONSTRAINT au_plan_limit_rules_reset_policy_check CHECK (
    reset_policy IN ('hourly', 'daily', 'weekly', 'monthly', 'never', 'custom')
  ),
  CONSTRAINT au_plan_limit_rules_reset_interval_value_check CHECK (
    reset_interval_value IS NULL OR reset_interval_value > 0
  ),
  CONSTRAINT au_plan_limit_rules_reset_interval_unit_check CHECK (
    reset_interval_unit IS NULL OR reset_interval_unit IN ('hour', 'day', 'week', 'month')
  ),
  CONSTRAINT au_plan_limit_rules_custom_interval_check CHECK (
    (
      reset_policy = 'custom'
      AND reset_interval_value IS NOT NULL
      AND reset_interval_unit IS NOT NULL
    )
    OR (
      reset_policy <> 'custom'
      AND reset_interval_value IS NULL
      AND reset_interval_unit IS NULL
    )
  ),
  CONSTRAINT au_plan_limit_rules_unlimited_value_check CHECK (
    NOT is_unlimited OR value IS NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_au_plan_limit_rules_scope ON public.au_plan_limit_rules(scope);
CREATE INDEX IF NOT EXISTS idx_au_plan_limit_rules_updated_at ON public.au_plan_limit_rules(updated_at DESC);

ALTER TABLE public.au_plan_limit_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_plan_limit_rules REPLICA IDENTITY FULL;

DROP POLICY IF EXISTS "au_plan_limit_rules_service_role" ON public.au_plan_limit_rules;
CREATE POLICY "au_plan_limit_rules_service_role"
ON public.au_plan_limit_rules
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_plan_limit_rules_read_authenticated" ON public.au_plan_limit_rules;
CREATE POLICY "au_plan_limit_rules_read_authenticated"
ON public.au_plan_limit_rules
FOR SELECT
TO authenticated
USING (TRUE);

GRANT SELECT ON public.au_plan_limit_rules TO authenticated;

DROP TRIGGER IF EXISTS trg_au_plan_limit_rules_updated_at ON public.au_plan_limit_rules;
CREATE TRIGGER trg_au_plan_limit_rules_updated_at
BEFORE UPDATE ON public.au_plan_limit_rules
FOR EACH ROW
EXECUTE FUNCTION public.set_row_updated_at();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.au_plan_limit_rules';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN undefined_object THEN NULL;
    END;
  END IF;
END
$$;

COMMIT;
