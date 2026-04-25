-- 1. Create au_security_events table
CREATE TABLE IF NOT EXISTS public.au_security_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_type TEXT NOT NULL, -- 'admin_login', 'rate_limit', 'webhook_fail', 'auth_fail'
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    ip_address TEXT,
    owner_id UUID REFERENCES public.au_users(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying by type and time
CREATE INDEX IF NOT EXISTS idx_security_events_type_time ON public.au_security_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_owner ON public.au_security_events (owner_id);

-- RLS: Only service role can insert (logs).
ALTER TABLE public.au_security_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.au_security_events TO service_role USING (true) WITH CHECK (true);


-- 2. Refactor au_rate_limits for Fixed Window Counter
DROP TABLE IF EXISTS public.au_rate_limits;

CREATE TABLE public.au_rate_limits (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID, -- Nullable for IP-only limits
    ip_hash TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    request_count INT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Composite unique index for UPSERT (ON CONFLICT)
-- We use COALESCE in the index to handle NULL owner_id for uniqueness
CREATE UNIQUE INDEX idx_rate_limits_window ON public.au_rate_limits (ip_hash, endpoint, window_start, COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'));

-- Index for cleanup
CREATE INDEX idx_rate_limits_cleanup ON public.au_rate_limits (window_start);

ALTER TABLE public.au_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.au_rate_limits TO service_role USING (true) WITH CHECK (true);

-- 3. RPC for Atomic Rate Limit Increment
CREATE OR REPLACE FUNCTION increment_rate_limit(
    p_ip_hash TEXT,
    p_owner_id UUID,
    p_endpoint TEXT,
    p_window_start TIMESTAMPTZ
) RETURNS INT AS $$
DECLARE
    current_count INT;
BEGIN
    INSERT INTO public.au_rate_limits (ip_hash, owner_id, endpoint, window_start, request_count)
    VALUES (p_ip_hash, p_owner_id, p_endpoint, p_window_start, 1)
    ON CONFLICT (ip_hash, endpoint, window_start, COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'))
    DO UPDATE SET request_count = au_rate_limits.request_count + 1
    RETURNING request_count INTO current_count;
    
    RETURN current_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Storage Security: Make 'documents' bucket private
UPDATE storage.buckets SET public = false WHERE id = 'documents';

-- 5. RLS Hardening
-- Ensure au_user_profiles is secure
ALTER TABLE public.au_user_profiles ENABLE ROW LEVEL SECURITY;

-- Drop potentially loose policies (if any exist by these names) and recreate stricter ones
DROP POLICY IF EXISTS "Users can update own profile" ON public.au_user_profiles;
DROP POLICY IF EXISTS "Service role manages profiles" ON public.au_user_profiles;

CREATE POLICY "Users can update own profile" ON public.au_user_profiles
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role manages profiles" ON public.au_user_profiles
    TO service_role USING (true) WITH CHECK (true);
