-- Comprehensive Plan Reset Metadata Migration
-- 20260307123000_plan_reset_metadata.sql

BEGIN;

-- 1. Sync Function Fix
-- We need to fix this first because any subsequent INSERT into feature_flags will trigger this.
CREATE OR REPLACE FUNCTION public.sync_feature_flags_to_legacy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Prevent trigger ping-pong loops.
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'au_feature_flags'
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.au_feature_flags WHERE key = OLD.key;
    RETURN OLD;
  END IF;

  -- Ensure we populate both is_enabled and enabled (which is NOT NULL)
  -- and also map config to value.
  INSERT INTO public.au_feature_flags (key, is_enabled, enabled, description, value, updated_at)
  VALUES (
    NEW.key,
    NEW.enabled,
    NEW.enabled,
    COALESCE(NEW.description, ''),
    COALESCE(NEW.config, '{}'::jsonb),
    COALESCE(NEW.updated_at, now())
  )
  ON CONFLICT (key) DO UPDATE
  SET is_enabled = EXCLUDED.is_enabled,
      enabled = EXCLUDED.enabled,
      description = EXCLUDED.description,
      value = EXCLUDED.value,
      updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

-- 2. Table Modifications: Update au_plan_limits
ALTER TABLE public.au_plan_limits
  ADD COLUMN IF NOT EXISTS tokens_reset_every_days INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS chats_reset_every_days INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS uploads_reset_every_days INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS documents_reset_every_days INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exams_reset_every_days INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS storage_reset_every_days INT NOT NULL DEFAULT 0;

-- 3. New Table Creation: au_plan_metadata
CREATE TABLE IF NOT EXISTS public.au_plan_metadata (
  plan TEXT PRIMARY KEY REFERENCES public.au_plans(plan) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  price_display TEXT NOT NULL DEFAULT '',
  monthly_amount_ngn INT NULL,
  monthly_compare_at_ngn INT NULL,
  monthly_badge TEXT NOT NULL DEFAULT '',
  weekly_amount_ngn INT NULL,
  weekly_compare_at_ngn INT NULL,
  weekly_badge TEXT NOT NULL DEFAULT '',
  feature_bullets JSONB NOT NULL DEFAULT '[]'::jsonb,
  cta_label TEXT NOT NULL DEFAULT 'Upgrade now',
  cta_href TEXT NOT NULL DEFAULT '/dashboard/settings/subscription',
  sort_order INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Quota Management: au_quota_windows
-- We'll implement it as a regular table for now, but ensure proper indexing.
CREATE TABLE IF NOT EXISTS public.au_quota_windows (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, metric)
);

CREATE INDEX IF NOT EXISTS idx_au_quota_windows_end ON public.au_quota_windows(window_end);

-- 5. Data Seeding: Plans
INSERT INTO public.au_plans (plan, is_default)
VALUES
  ('free', TRUE),
  ('pro', FALSE),
  ('premium', FALSE)
ON CONFLICT (plan) DO UPDATE SET is_default = EXCLUDED.is_default;

-- 6. Data Seeding: Limits
INSERT INTO public.au_plan_limits (
  plan,
  max_file_size_mb,
  max_uploads_total,
  max_documents_total,
  max_chats_total,
  max_exams_total,
  max_tokens_total,
  max_storage_mb,
  max_concurrent_jobs,
  tokens_reset_every_days,
  chats_reset_every_days,
  uploads_reset_every_days,
  documents_reset_every_days,
  exams_reset_every_days,
  storage_reset_every_days
)
VALUES
  ('free', 50, 50, 50, 3000, 10, 25000, 2000, 1, 1, 1, 0, 0, 1, 0),
  ('pro', 50, 500, 500, 30000, 200, 2500000, 20000, 3, 1, 1, 0, 0, 1, 0),
  ('premium', 50, 1500, 1500, 100000, 1000, 10000000, 100000, 6, 1, 1, 0, 0, 1, 0)
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
  tokens_reset_every_days = EXCLUDED.tokens_reset_every_days,
  chats_reset_every_days = EXCLUDED.chats_reset_every_days,
  uploads_reset_every_days = EXCLUDED.uploads_reset_every_days,
  documents_reset_every_days = EXCLUDED.documents_reset_every_days,
  exams_reset_every_days = EXCLUDED.exams_reset_every_days,
  storage_reset_every_days = EXCLUDED.storage_reset_every_days,
  updated_at = now();

-- 7. Data Seeding: Metadata
INSERT INTO public.au_plan_metadata (
  plan, label, description, price_display, monthly_amount_ngn, monthly_compare_at_ngn, monthly_badge, 
  weekly_amount_ngn, weekly_compare_at_ngn, weekly_badge, feature_bullets, cta_label, cta_href, sort_order
)
VALUES
  ('free', 'Free', 'Core study tools with sensible daily AI quotas and lifetime document caps.', 'NGN 0', 0, NULL, '', 0, NULL, '', '["Core chat","Upload up to 50 documents","Practice from saved outputs","Basic support"]'::jsonb, 'Current plan', '/dashboard', 0),
  ('pro', 'Pro', 'Higher daily AI budgets, more storage, and access to advanced study workflows.', 'NGN 4,500/month or NGN 1,500/week', 4500, 6000, 'Save 25%', 1500, 2500, 'Save 40%', '["Knowledge Hub","Exam Prediction Engine","Priority processing","Expanded quotas"]'::jsonb, 'Upgrade now', '/dashboard/settings/subscription', 1),
  ('premium', 'Premium', 'Custom higher-volume workspace for extended storage, concurrency, and tailored support.', 'Custom pricing', NULL, NULL, '', NULL, NULL, '', '["Everything in Pro","Higher concurrency","Custom support","Expanded storage"]'::jsonb, 'Contact admin', '/dashboard/settings/subscription', 2)
ON CONFLICT (plan) DO UPDATE
SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  price_display = EXCLUDED.price_display,
  monthly_amount_ngn = EXCLUDED.monthly_amount_ngn,
  monthly_compare_at_ngn = EXCLUDED.monthly_compare_at_ngn,
  monthly_badge = EXCLUDED.monthly_badge,
  weekly_amount_ngn = EXCLUDED.weekly_amount_ngn,
  weekly_compare_at_ngn = EXCLUDED.weekly_compare_at_ngn,
  weekly_badge = EXCLUDED.weekly_badge,
  feature_bullets = EXCLUDED.feature_bullets,
  cta_label = EXCLUDED.cta_label,
  cta_href = EXCLUDED.cta_href,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- 8. Security Implementation: RLS
ALTER TABLE public.au_plan_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.au_quota_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "au_plan_metadata_service_role" ON public.au_plan_metadata;
CREATE POLICY "au_plan_metadata_service_role" ON public.au_plan_metadata FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_plan_metadata_read_authenticated" ON public.au_plan_metadata;
CREATE POLICY "au_plan_metadata_read_authenticated" ON public.au_plan_metadata FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "au_quota_windows_service_role" ON public.au_quota_windows;
CREATE POLICY "au_quota_windows_service_role" ON public.au_quota_windows FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_quota_windows_select_own" ON public.au_quota_windows;
CREATE POLICY "au_quota_windows_select_own" ON public.au_quota_windows FOR SELECT TO authenticated USING (user_id = auth.uid());

GRANT SELECT ON public.au_plan_metadata TO authenticated;
GRANT SELECT ON public.au_plan_limits TO authenticated;
GRANT SELECT ON public.au_quota_windows TO authenticated;

-- 9. Triggers
DROP TRIGGER IF EXISTS trg_au_plan_metadata_updated_at ON public.au_plan_metadata;
CREATE TRIGGER trg_au_plan_metadata_updated_at
BEFORE UPDATE ON public.au_plan_metadata
FOR EACH ROW
EXECUTE FUNCTION public.set_row_updated_at();

-- 10. Data Seeding: Feature Flags
DO $$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (key, enabled, category, description, scope, config, updated_at)
    VALUES
      ('pro_upload_100mb', FALSE, 'limits', 'Allow Pro uploads up to 100MB while other plans remain at 50MB.', 'global', '{}'::jsonb, now()),
      ('enable_exam_prediction', TRUE, 'features', 'Enable Exam Prediction Engine surface/API.', 'global', '{}'::jsonb, now()),
      ('enable_knowledge_hub', TRUE, 'features', 'Enable Knowledge Hub surface/API.', 'global', '{}'::jsonb, now()),
      ('enable_practice_exam_generation', TRUE, 'features', 'Enable Practice Exam generation flow.', 'global', '{}'::jsonb, now()),
      ('pro_required_exam_prediction', TRUE, 'features', 'Require Pro plan for Exam Prediction Engine.', 'global', '{}'::jsonb, now()),
      ('pro_required_knowledge_hub', TRUE, 'features', 'Require Pro plan for Knowledge Hub.', 'global', '{}'::jsonb, now())
    ON CONFLICT (key) DO UPDATE
    SET
      enabled = EXCLUDED.enabled,
      category = EXCLUDED.category,
      description = EXCLUDED.description,
      scope = EXCLUDED.scope,
      config = EXCLUDED.config,
      updated_at = now();
  END IF;
END $$;

COMMIT;
