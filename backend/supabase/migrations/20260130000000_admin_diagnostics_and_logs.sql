-- Migration: Admin Diagnostics and Debug Logs
-- 20260130000000_admin_diagnostics_and_logs.sql

-- 1. Upgrade au_debug_logs table
DO $$ 
BEGIN
    -- Rename component to source if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='au_debug_logs' AND column_name='component') THEN
        ALTER TABLE au_debug_logs RENAME COLUMN component TO source;
    END IF;

    -- Add new columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='au_debug_logs' AND column_name='level') THEN
        ALTER TABLE au_debug_logs ADD COLUMN level TEXT NOT NULL DEFAULT 'info';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='au_debug_logs' AND column_name='user_id') THEN
        ALTER TABLE au_debug_logs ADD COLUMN user_id UUID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='au_debug_logs' AND column_name='guest_session_id') THEN
        ALTER TABLE au_debug_logs ADD COLUMN guest_session_id UUID;
    END IF;
END $$;

-- Ensure indexes
CREATE INDEX IF NOT EXISTS idx_debug_logs_level ON au_debug_logs(level);
CREATE INDEX IF NOT EXISTS idx_debug_logs_source ON au_debug_logs(source);
CREATE INDEX IF NOT EXISTS idx_debug_logs_created_at ON au_debug_logs(created_at DESC);

-- 2. Add health tracking to Key Groups
ALTER TABLE au_key_groups ADD COLUMN IF NOT EXISTS health_score FLOAT DEFAULT 1.0;
ALTER TABLE au_key_groups ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ;
ALTER TABLE au_key_groups ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;
ALTER TABLE au_key_groups ADD COLUMN IF NOT EXISTS error_count INT DEFAULT 0;

-- 3. Schema Cache Reload RPC
CREATE OR REPLACE FUNCTION reload_schema_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NOTIFY pgrst, 'reload schema';
END;
$$;

-- 4. RLS Policies (Admin only)
ALTER TABLE au_debug_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing if any to avoid errors on retry
DROP POLICY IF EXISTS "Admin access only" ON au_debug_logs;
CREATE POLICY "Admin access only" ON au_debug_logs FOR ALL USING (false);

-- 5. Helper to log from SQL if needed
CREATE OR REPLACE FUNCTION log_debug(
    p_level TEXT,
    p_source TEXT,
    p_message TEXT,
    p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO au_debug_logs (level, source, message, details)
    VALUES (p_level, p_source, p_message, p_details);
END;
$$;
