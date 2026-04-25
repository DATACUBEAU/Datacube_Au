-- Canonical plan limits, effective entitlements, asked-before cache, and proxy idempotency.
-- 20260306153000_limits_cost_controls.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.au_plans (
  plan TEXT PRIMARY KEY,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.au_plan_limits (
  plan TEXT PRIMARY KEY REFERENCES public.au_plans(plan) ON DELETE CASCADE,
  max_file_size_mb INT NOT NULL,
  max_uploads_total INT NOT NULL,
  max_documents_total INT NOT NULL,
  max_chats_total INT NOT NULL,
  max_exams_total INT NOT NULL,
  max_tokens_total BIGINT NOT NULL,
  max_storage_mb INT NOT NULL,
  max_concurrent_jobs INT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.au_user_entitlements (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL REFERENCES public.au_plans(plan),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.au_idempotency (
  key TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  request_hash TEXT NULL,
  response JSONB NOT NULL DEFAULT '{}'::jsonb,
  status_code INT NOT NULL DEFAULT 200,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '60 seconds'),
  correlation_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_au_idempotency_user_created
  ON public.au_idempotency(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_au_idempotency_expires_at
  ON public.au_idempotency(expires_at);

CREATE TABLE IF NOT EXISTS public.au_answer_cache (
  cache_key TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL DEFAULT 'chat',
  normalized_question TEXT NOT NULL,
  active_doc_scope TEXT NOT NULL DEFAULT '',
  settings_hash TEXT NOT NULL DEFAULT '',
  response JSONB NOT NULL DEFAULT '{}'::jsonb,
  model TEXT NULL,
  tokens INT NOT NULL DEFAULT 0,
  cost_usd NUMERIC NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  last_hit_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hit_count INT NOT NULL DEFAULT 0
);

ALTER TABLE public.au_answer_cache
  ADD COLUMN IF NOT EXISTS feature TEXT NOT NULL DEFAULT 'chat';

CREATE INDEX IF NOT EXISTS idx_au_answer_cache_user_created
  ON public.au_answer_cache(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_au_answer_cache_expires_at
  ON public.au_answer_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_au_answer_cache_feature
  ON public.au_answer_cache(feature, created_at DESC);

CREATE TABLE IF NOT EXISTS public.au_feature_flags (
  key TEXT PRIMARY KEY,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.au_feature_flags
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN;

ALTER TABLE public.au_feature_flags
  ADD COLUMN IF NOT EXISTS value JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.au_feature_flags
SET
  enabled = COALESCE(enabled, is_enabled, FALSE),
  value = COALESCE(value, '{}'::jsonb)
WHERE enabled IS NULL
   OR value IS NULL;

ALTER TABLE public.au_feature_flags
  ALTER COLUMN enabled SET NOT NULL;

INSERT INTO public.au_plans (plan, is_default)
VALUES
  ('free', TRUE),
  ('pro', FALSE)
ON CONFLICT (plan) DO UPDATE
SET is_default = EXCLUDED.is_default;

UPDATE public.au_plans
SET is_default = (plan = 'free');

INSERT INTO public.au_plan_limits (
  plan,
  max_file_size_mb,
  max_uploads_total,
  max_documents_total,
  max_chats_total,
  max_exams_total,
  max_tokens_total,
  max_storage_mb,
  max_concurrent_jobs
)
VALUES
  ('free', 50, 50, 50, 3000, 10, 25000, 2000, 1),
  ('pro', 50, 500, 500, 30000, 200, 2500000, 20000, 3)
ON CONFLICT (plan) DO UPDATE
SET
  max_file_size_mb = EXCLUDED.max_file_size_mb,
  max_uploads_total = EXCLUDED.max_uploads_total,
  max_documents_total = EXCLUDED.max_documents_total,
  max_chats_total = EXCLUDED.max_chats_total,
  max_exams_total = EXCLUDED.max_exams_total,
  max_tokens_total = EXCLUDED.max_tokens_total,
  max_storage_mb = EXCLUDED.max_storage_mb,
  max_concurrent_jobs = EXCLUDED.max_concurrent_jobs,
  updated_at = now();

-- INSERT INTO public.feature_flags (key, enabled, category, description, scope, config)
-- VALUES
--   ('pro_upload_100mb', FALSE, 'limits', 'Allow Pro uploads up to 100MB while Free remains capped at 50MB.', 'global', '{}'::jsonb),
--   ('enable_exam_prediction', TRUE, 'features', 'Enable Exam Prediction Engine surface/API.', 'global', '{}'::jsonb),
--   ('enable_knowledge_hub', TRUE, 'features', 'Enable Knowledge Hub surface/API.', 'global', '{}'::jsonb),
--   ('enable_practice_exam_generation', TRUE, 'features', 'Enable Practice Exam generation flow.', 'global', '{}'::jsonb),
--   ('pro_required_exam_prediction', TRUE, 'features', 'Require Pro plan for Exam Prediction Engine.', 'global', '{}'::jsonb),
--   ('pro_required_knowledge_hub', TRUE, 'features', 'Require Pro plan for Knowledge Hub.', 'global', '{}'::jsonb)
-- ON CONFLICT (key) DO UPDATE
-- SET
--   enabled = EXCLUDED.enabled,
--   category = EXCLUDED.category,
--   description = EXCLUDED.description,
--   scope = EXCLUDED.scope,
--   config = EXCLUDED.config,
--   updated_at = now();

INSERT INTO public.au_feature_flags (key, is_enabled, enabled, description, value, updated_at)
VALUES
  ('pro_upload_100mb', FALSE, FALSE, 'Allow Pro uploads up to 100MB while Free remains capped at 50MB.', '{}'::jsonb, now()),
  ('enable_exam_prediction', TRUE, TRUE, 'Enable Exam Prediction Engine surface/API.', '{}'::jsonb, now()),
  ('enable_knowledge_hub', TRUE, TRUE, 'Enable Knowledge Hub surface/API.', '{}'::jsonb, now()),
  ('enable_practice_exam_generation', TRUE, TRUE, 'Enable Practice Exam generation flow.', '{}'::jsonb, now()),
  ('pro_required_exam_prediction', TRUE, TRUE, 'Require Pro plan for Exam Prediction Engine.', '{}'::jsonb, now()),
  ('pro_required_knowledge_hub', TRUE, TRUE, 'Require Pro plan for Knowledge Hub.', '{}'::jsonb, now())
ON CONFLICT (key) DO UPDATE
SET
  is_enabled = EXCLUDED.is_enabled,
  enabled = EXCLUDED.enabled,
  description = EXCLUDED.description,
  value = EXCLUDED.value,
  updated_at = now();

ALTER TABLE public.au_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_plan_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_user_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_answer_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "au_plans_service_role" ON public.au_plans;
CREATE POLICY "au_plans_service_role"
ON public.au_plans
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_plans_read_authenticated" ON public.au_plans;
CREATE POLICY "au_plans_read_authenticated"
ON public.au_plans
FOR SELECT
TO authenticated
USING (TRUE);

DROP POLICY IF EXISTS "au_plan_limits_service_role" ON public.au_plan_limits;
CREATE POLICY "au_plan_limits_service_role"
ON public.au_plan_limits
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_user_entitlements_select_own" ON public.au_user_entitlements;
CREATE POLICY "au_user_entitlements_select_own"
ON public.au_user_entitlements
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "au_user_entitlements_service_role" ON public.au_user_entitlements;
CREATE POLICY "au_user_entitlements_service_role"
ON public.au_user_entitlements
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_idempotency_select_own" ON public.au_idempotency;
CREATE POLICY "au_idempotency_select_own"
ON public.au_idempotency
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "au_idempotency_service_role" ON public.au_idempotency;
CREATE POLICY "au_idempotency_service_role"
ON public.au_idempotency
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_answer_cache_select_own" ON public.au_answer_cache;
CREATE POLICY "au_answer_cache_select_own"
ON public.au_answer_cache
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "au_answer_cache_service_role" ON public.au_answer_cache;
CREATE POLICY "au_answer_cache_service_role"
ON public.au_answer_cache
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_feature_flags_service_role" ON public.au_feature_flags;
CREATE POLICY "au_feature_flags_service_role"
ON public.au_feature_flags
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_feature_flags_read_authenticated" ON public.au_feature_flags;
CREATE POLICY "au_feature_flags_read_authenticated"
ON public.au_feature_flags
FOR SELECT
TO authenticated
USING (TRUE);

GRANT SELECT ON public.au_plans TO authenticated;
GRANT SELECT ON public.au_user_entitlements TO authenticated;
GRANT SELECT ON public.au_idempotency TO authenticated;
GRANT SELECT ON public.au_answer_cache TO authenticated;
GRANT SELECT ON public.au_feature_flags TO authenticated;

DROP TRIGGER IF EXISTS trg_au_plan_limits_updated_at ON public.au_plan_limits;
CREATE TRIGGER trg_au_plan_limits_updated_at
BEFORE UPDATE ON public.au_plan_limits
FOR EACH ROW
EXECUTE FUNCTION public.set_row_updated_at();

DROP TRIGGER IF EXISTS trg_au_user_entitlements_updated_at ON public.au_user_entitlements;
CREATE TRIGGER trg_au_user_entitlements_updated_at
BEFORE UPDATE ON public.au_user_entitlements
FOR EACH ROW
EXECUTE FUNCTION public.set_row_updated_at();

DROP TRIGGER IF EXISTS trg_au_feature_flags_updated_at ON public.au_feature_flags;
CREATE TRIGGER trg_au_feature_flags_updated_at
BEFORE UPDATE ON public.au_feature_flags
FOR EACH ROW
EXECUTE FUNCTION public.set_row_updated_at();

COMMIT;
