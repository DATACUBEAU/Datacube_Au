-- Migration: Add AU Answer Cache
-- 20260207090000_au_answer_cache.sql

CREATE TABLE IF NOT EXISTS public.au_answer_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_key TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    guest_session_id UUID,
    answer TEXT NOT NULL,
    citations JSONB DEFAULT '[]'::JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    policy_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_au_answer_cache_key ON public.au_answer_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_au_answer_cache_user ON public.au_answer_cache(user_id);
CREATE INDEX IF NOT EXISTS idx_au_answer_cache_guest ON public.au_answer_cache(guest_session_id);

ALTER TABLE public.au_answer_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.au_answer_cache
    FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
