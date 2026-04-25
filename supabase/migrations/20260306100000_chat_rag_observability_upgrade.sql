-- Chat/RAG behavior, observability, feedback, preferences, and feature-output caching
-- 20260306100000_chat_rag_observability_upgrade.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.au_user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tone TEXT NOT NULL DEFAULT 'friendly' CHECK (tone IN ('friendly', 'professional', 'strict')),
  verbosity TEXT NOT NULL DEFAULT 'medium' CHECK (verbosity IN ('short', 'medium', 'deep')),
  citations BOOLEAN NOT NULL DEFAULT TRUE,
  answer_scope TEXT NOT NULL DEFAULT 'docs_preferred'
    CHECK (answer_scope IN ('docs_only', 'docs_preferred', 'general_allowed')),
  language TEXT NOT NULL DEFAULT 'english',
  safety TEXT NOT NULL DEFAULT 'standard' CHECK (safety IN ('standard', 'strict')),
  instructions TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.au_request_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '60 seconds'),
  user_id UUID NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NULL,
  response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status_code INT NOT NULL DEFAULT 200,
  request_id TEXT NULL,
  correlation_id TEXT NULL,
  UNIQUE (user_id, feature, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_au_request_idempotency_expires_at
  ON public.au_request_idempotency(expires_at);
CREATE INDEX IF NOT EXISTS idx_au_request_idempotency_created_at
  ON public.au_request_idempotency(created_at DESC);

ALTER TABLE IF EXISTS public.au_documents
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

CREATE TABLE IF NOT EXISTS public.au_document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.au_documents(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  source_uri TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_au_document_versions_document_created
  ON public.au_document_versions(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_au_document_versions_hash
  ON public.au_document_versions(content_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_au_document_versions_active_document
  ON public.au_document_versions(document_id)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS public.au_document_insights (
  version_id UUID PRIMARY KEY REFERENCES public.au_document_versions(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  outline JSONB NOT NULL DEFAULT '[]'::jsonb,
  key_topics TEXT[] NOT NULL DEFAULT '{}'::text[],
  suggested_questions TEXT[] NOT NULL DEFAULT '{}'::text[],
  model TEXT NULL,
  tokens INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_au_document_insights_refreshed_at
  ON public.au_document_insights(refreshed_at DESC);

CREATE TABLE IF NOT EXISTS public.au_feature_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_version_id UUID NOT NULL REFERENCES public.au_document_versions(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  output JSONB NOT NULL,
  model TEXT NULL,
  tokens INT NOT NULL DEFAULT 0,
  cost_usd NUMERIC NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, doc_version_id, feature)
);

CREATE INDEX IF NOT EXISTS idx_au_feature_outputs_user_created
  ON public.au_feature_outputs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_au_feature_outputs_feature
  ON public.au_feature_outputs(feature, created_at DESC);

CREATE TABLE IF NOT EXISTS public.au_practice_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_version_id UUID NOT NULL REFERENCES public.au_document_versions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answers JSONB NOT NULL,
  score INT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_au_practice_attempts_user_doc
  ON public.au_practice_attempts(user_id, doc_version_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.au_user_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  section TEXT NOT NULL,
  rating INT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_au_user_feedback_created_at
  ON public.au_user_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_au_user_feedback_section
  ON public.au_user_feedback(section);

ALTER TABLE IF EXISTS public.au_model_usage
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS success BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS latency_ms INT NULL,
  ADD COLUMN IF NOT EXISTS request_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS correlation_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS error TEXT NULL,
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC NULL;

ALTER TABLE IF EXISTS public.au_model_usage
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

UPDATE public.au_model_usage
SET
  provider = COALESCE(provider, metadata->>'provider', 'openrouter'),
  model = COALESCE(model, model_id),
  cost_usd = COALESCE(cost_usd, cost::numeric),
  success = COALESCE(success, TRUE);

CREATE INDEX IF NOT EXISTS idx_au_model_usage_created_at_desc
  ON public.au_model_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_au_model_usage_feature_created
  ON public.au_model_usage(feature, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_au_model_usage_user_created
  ON public.au_model_usage(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_au_model_usage_success
  ON public.au_model_usage(success, created_at DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'au_model_usage'
      AND column_name = 'model_id'
  ) THEN
    UPDATE public.au_model_usage
    SET model_id = model
    WHERE (model_id IS NULL OR model_id = '')
      AND model IS NOT NULL;
  END IF;
END;
$$;

INSERT INTO public.feature_flags (key, enabled, category, description, scope, config)
VALUES
  ('enable_exam_prediction', TRUE, 'features', 'Enable Exam Prediction Engine surface/API.', 'global', '{}'::jsonb),
  ('enable_knowledge_hub', TRUE, 'features', 'Enable Knowledge Hub surface/API.', 'global', '{}'::jsonb),
  ('enable_practice_exam_generation', TRUE, 'features', 'Enable Practice Exam generation flow.', 'global', '{}'::jsonb),
  ('pro_required_exam_prediction', TRUE, 'features', 'Require Pro plan for Exam Prediction Engine.', 'global', '{}'::jsonb),
  ('pro_required_knowledge_hub', TRUE, 'features', 'Require Pro plan for Knowledge Hub.', 'global', '{}'::jsonb)
ON CONFLICT (key) DO UPDATE
SET
  category = EXCLUDED.category,
  description = EXCLUDED.description;

ALTER TABLE public.au_user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_request_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_document_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_feature_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_practice_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_user_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_model_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "au_user_preferences_select_own" ON public.au_user_preferences;
CREATE POLICY "au_user_preferences_select_own"
ON public.au_user_preferences
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "au_user_preferences_upsert_own" ON public.au_user_preferences;
CREATE POLICY "au_user_preferences_upsert_own"
ON public.au_user_preferences
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "au_user_preferences_service_role" ON public.au_user_preferences;
CREATE POLICY "au_user_preferences_service_role"
ON public.au_user_preferences
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_request_idempotency_select_own" ON public.au_request_idempotency;
CREATE POLICY "au_request_idempotency_select_own"
ON public.au_request_idempotency
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "au_request_idempotency_service_role" ON public.au_request_idempotency;
CREATE POLICY "au_request_idempotency_service_role"
ON public.au_request_idempotency
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_document_versions_select_own" ON public.au_document_versions;
CREATE POLICY "au_document_versions_select_own"
ON public.au_document_versions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.au_documents d
    WHERE d.id = document_id
      AND d.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "au_document_versions_service_role" ON public.au_document_versions;
CREATE POLICY "au_document_versions_service_role"
ON public.au_document_versions
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_document_insights_select_own" ON public.au_document_insights;
CREATE POLICY "au_document_insights_select_own"
ON public.au_document_insights
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.au_document_versions v
    JOIN public.au_documents d ON d.id = v.document_id
    WHERE v.id = version_id
      AND d.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "au_document_insights_service_role" ON public.au_document_insights;
CREATE POLICY "au_document_insights_service_role"
ON public.au_document_insights
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_feature_outputs_select_own" ON public.au_feature_outputs;
CREATE POLICY "au_feature_outputs_select_own"
ON public.au_feature_outputs
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "au_feature_outputs_service_role" ON public.au_feature_outputs;
CREATE POLICY "au_feature_outputs_service_role"
ON public.au_feature_outputs
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_practice_attempts_select_own" ON public.au_practice_attempts;
CREATE POLICY "au_practice_attempts_select_own"
ON public.au_practice_attempts
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "au_practice_attempts_insert_own" ON public.au_practice_attempts;
CREATE POLICY "au_practice_attempts_insert_own"
ON public.au_practice_attempts
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "au_practice_attempts_service_role" ON public.au_practice_attempts;
CREATE POLICY "au_practice_attempts_service_role"
ON public.au_practice_attempts
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_user_feedback_insert_authenticated" ON public.au_user_feedback;
CREATE POLICY "au_user_feedback_insert_authenticated"
ON public.au_user_feedback
FOR INSERT
TO authenticated
WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "au_user_feedback_insert_anon" ON public.au_user_feedback;
CREATE POLICY "au_user_feedback_insert_anon"
ON public.au_user_feedback
FOR INSERT
TO anon
WITH CHECK (user_id IS NULL);

DROP POLICY IF EXISTS "au_user_feedback_select_own" ON public.au_user_feedback;
CREATE POLICY "au_user_feedback_select_own"
ON public.au_user_feedback
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "au_user_feedback_admin_all" ON public.au_user_feedback;
CREATE POLICY "au_user_feedback_admin_all"
ON public.au_user_feedback
FOR ALL
TO authenticated
USING (public.is_conex_admin(auth.uid()))
WITH CHECK (public.is_conex_admin(auth.uid()));

DROP POLICY IF EXISTS "au_user_feedback_service_role" ON public.au_user_feedback;
CREATE POLICY "au_user_feedback_service_role"
ON public.au_user_feedback
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Users can view own model usage" ON public.au_model_usage;
DROP POLICY IF EXISTS "au_model_usage_select_own" ON public.au_model_usage;
CREATE POLICY "au_model_usage_select_own"
ON public.au_model_usage
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "au_model_usage_admin_read" ON public.au_model_usage;
CREATE POLICY "au_model_usage_admin_read"
ON public.au_model_usage
FOR SELECT
TO authenticated
USING (public.is_conex_admin(auth.uid()));

DROP POLICY IF EXISTS "au_model_usage_service_role" ON public.au_model_usage;
CREATE POLICY "au_model_usage_service_role"
ON public.au_model_usage
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP TRIGGER IF EXISTS trg_au_user_preferences_updated_at ON public.au_user_preferences;
CREATE TRIGGER trg_au_user_preferences_updated_at
BEFORE UPDATE ON public.au_user_preferences
FOR EACH ROW
EXECUTE FUNCTION public.set_row_updated_at();

DROP TRIGGER IF EXISTS trg_au_feature_outputs_updated_at ON public.au_feature_outputs;
CREATE TRIGGER trg_au_feature_outputs_updated_at
BEFORE UPDATE ON public.au_feature_outputs
FOR EACH ROW
EXECUTE FUNCTION public.set_row_updated_at();

COMMIT;
