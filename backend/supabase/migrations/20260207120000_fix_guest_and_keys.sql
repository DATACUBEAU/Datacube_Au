-- Fix Guest Sessions and Keys
-- 20260207120000_fix_guest_and_keys.sql

-- 1. Ensure au_guest_sessions table exists and is correct
CREATE TABLE IF NOT EXISTS au_guest_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fingerprint TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ DEFAULT (now() + interval '24 hours'),
    last_active_at TIMESTAMPTZ DEFAULT now(),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 2. Ensure RLS
ALTER TABLE au_guest_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages guest sessions" ON au_guest_sessions;
CREATE POLICY "Service role manages guest sessions" ON au_guest_sessions
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

-- 3. Ensure indexes
CREATE INDEX IF NOT EXISTS idx_guest_sessions_ip_hash ON au_guest_sessions(ip_hash);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_expires_at ON au_guest_sessions(expires_at);

-- 4. Fix au_conex_config if missing
INSERT INTO au_conex_config (id, billing_enabled, paystack_amount_weekly, paystack_amount_monthly)
VALUES (1, true, 1900, 4500)
ON CONFLICT (id) DO NOTHING;

-- 5. Grant permissions to service_role (just in case)
GRANT ALL ON au_guest_sessions TO service_role;
GRANT ALL ON au_conex_config TO service_role;
