-- Migration: Add rate limiting table for admin actions
-- 20260131000003_admin_rate_limiting.sql

CREATE TABLE IF NOT EXISTS au_admin_rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast cleanup and lookups
CREATE INDEX IF NOT EXISTS idx_admin_rate_limits_identifier_created_at ON au_admin_rate_limits(identifier, created_at DESC);

-- RLS: Only service_role can access
ALTER TABLE au_admin_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin access only" ON au_admin_rate_limits FOR ALL USING (false);

-- Notify schema reload
NOTIFY pgrst, 'reload schema';
