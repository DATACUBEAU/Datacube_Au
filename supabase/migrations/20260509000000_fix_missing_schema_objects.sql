-- Production Fix Migration: Missing schema objects
-- Resolves:
--   1. au_documents.bucket column — referenced by upload handler but never added to au_documents
--   2. au_config table — migration file au_billing_limits.sql was never picked up by Supabase CLI
--      because it lacks the required YYYYMMDDHHMMSS_ timestamp prefix
--   3. au_activity_log table — used by analytics.ts but never created
--   4. au_model_routing table — used by admin handler but never created via timestamped migration

-- ============================================================
-- 1. Add missing 'bucket' column to au_documents
-- ============================================================
-- The column was added to au_worker_jobs (20260225013000) but not au_documents.
-- The upload handler inserts bucket into au_documents — this fixes the schema cache error.
ALTER TABLE public.au_documents
  ADD COLUMN IF NOT EXISTS bucket text DEFAULT 'documents';

-- ============================================================
-- 2. Ensure au_config table exists
-- ============================================================
-- Originally defined in au_billing_limits.sql (no timestamp prefix → never ran).
CREATE TABLE IF NOT EXISTS public.au_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    billing_enabled BOOLEAN DEFAULT false,
    free_chat_daily_limit INT DEFAULT 10,
    free_exam_daily_limit INT DEFAULT 2,
    free_upload_daily_limit INT DEFAULT 3,
    free_max_upload_mb INT DEFAULT 10,
    premium_models_paid_only BOOLEAN DEFAULT true,
    alert_config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS au_config_one_row ON public.au_config((true));

INSERT INTO public.au_config (
  billing_enabled,
  free_chat_daily_limit,
  free_exam_daily_limit,
  free_upload_daily_limit,
  free_max_upload_mb
)
VALUES (false, 10, 2, 3, 10)
ON CONFLICT DO NOTHING;

ALTER TABLE public.au_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read for everyone" ON public.au_config;
CREATE POLICY "Allow read for everyone" ON public.au_config
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role can update config" ON public.au_config;
CREATE POLICY "Service role can update config" ON public.au_config
  FOR UPDATE USING (auth.jwt() ->> 'role' = 'service_role');

DROP POLICY IF EXISTS "Service role can insert config" ON public.au_config;
CREATE POLICY "Service role can insert config" ON public.au_config
  FOR INSERT WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Also add columns that the admin handler expects but may not exist
ALTER TABLE public.au_config
  ADD COLUMN IF NOT EXISTS premium_models_paid_only BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS alert_config JSONB DEFAULT '{}'::jsonb;

-- ============================================================
-- 3. Ensure au_activity_log table exists
-- ============================================================
-- Used by the analytics module for client-side event logging.
CREATE TABLE IF NOT EXISTS public.au_activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_name TEXT NOT NULL,
    event_params JSONB DEFAULT '{}'::jsonb,
    tier TEXT,
    client_timestamp TEXT,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.au_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own activity" ON public.au_activity_log;
CREATE POLICY "Users can insert own activity" ON public.au_activity_log
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Service role full access activity" ON public.au_activity_log;
CREATE POLICY "Service role full access activity" ON public.au_activity_log
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE INDEX IF NOT EXISTS idx_au_activity_log_event_name
  ON public.au_activity_log (event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_au_activity_log_user
  ON public.au_activity_log (user_id, created_at DESC);

-- ============================================================
-- 4. Ensure au_model_routing table exists
-- ============================================================
-- Used by admin handler get_registry action.
CREATE TABLE IF NOT EXISTS public.au_model_routing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id TEXT UNIQUE NOT NULL,
    display_name TEXT,
    provider TEXT DEFAULT 'openrouter',
    registry TEXT DEFAULT 'free',
    is_active BOOLEAN DEFAULT true,
    tier_required TEXT DEFAULT 'free',
    priority INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.au_model_routing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read for everyone model routing" ON public.au_model_routing;
CREATE POLICY "Allow read for everyone model routing" ON public.au_model_routing
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role can manage model routing" ON public.au_model_routing;
CREATE POLICY "Service role can manage model routing" ON public.au_model_routing
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================
-- 5. Notify PostgREST to reload schema cache
-- ============================================================
SELECT public.reload_schema_cache();
