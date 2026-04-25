-- Migration: Auth Mapping and Executor Decision Logic
-- 20260201000000_auth_mappings.sql

-- 1. Create the auth mapping table
CREATE TABLE IF NOT EXISTS au_auth_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supabase_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    external_auth_id TEXT NOT NULL, -- Firebase UID
    provider TEXT NOT NULL DEFAULT 'firebase',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(supabase_user_id, provider),
    UNIQUE(external_auth_id, provider)
);

-- 2. Add RLS to au_auth_mappings
ALTER TABLE au_auth_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own auth mappings" ON au_auth_mappings
    FOR SELECT USING (auth.uid() = supabase_user_id);

CREATE POLICY "Service role can manage all auth mappings" ON au_auth_mappings
    FOR ALL USING (true) WITH CHECK (true);

-- 3. Create a table for executor decisions/limits (Auth Cycling)
CREATE TABLE IF NOT EXISTS au_auth_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO au_auth_settings (key, value)
VALUES ('executor_config', '{"max_supabase_users": 1000, "force_firebase_executor": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 4. Function to decide auth executor
CREATE OR REPLACE FUNCTION decide_auth_executor(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_force_firebase BOOLEAN;
    v_max_users INTEGER;
    v_current_users INTEGER;
BEGIN
    -- Get settings
    SELECT (value->>'force_firebase_executor')::BOOLEAN, (value->>'max_supabase_users')::INTEGER
    INTO v_force_firebase, v_max_users
    FROM au_auth_settings
    WHERE key = 'executor_config';

    IF v_force_firebase THEN
        RETURN 'firebase';
    END IF;

    -- Optional: Check user count if needed
    -- SELECT count(*) INTO v_current_users FROM auth.users;
    -- IF v_current_users > v_max_users THEN RETURN 'firebase'; END IF;

    RETURN 'supabase';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Notify schema reload
NOTIFY pgrst, 'reload schema';
